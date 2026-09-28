"""Truth Receipt service — build, seal, and verify sealed query snapshots.

A receipt is a tamper-evident, publicly-viewable snapshot of one query's
question/answer/claims/sources at the moment it was sealed. The `canonical`
JSON encoding is what the `seal` (sha256) and `signature` (HMAC-SHA256) are
computed over; anything that changes the canonical form invalidates the seal.

    payload = build_payload(query, claims, workspace)
    canonical = canonicalize(payload)
    seal, signature = seal_and_sign(canonical)

`verify()` recomputes both from a `Receipt` row's stored fields so a public
viewer (and the frontend's own WebCrypto check) can confirm nothing was
tampered with after the fact.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from typing import Any

from app.config import settings
from app.models.query import Query
from app.models.receipt import Receipt
from app.models.workspace import Workspace
from app.schemas._datetime import utc_iso

RECEIPT_VERSION = "tl-receipt/1"
ISSUER = "TruthLens AI"
EXCERPT_MAX_CHARS = 1200

_SOURCE_MARKER_RE = re.compile(r"\[source:(\d+)\]")


def _load_sources(query: Query) -> list[dict[str, Any]]:
    """Parse `Query.response_sources` (JSON text) back into context dicts."""
    try:
        loaded = json.loads(query.response_sources or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return [s for s in loaded if isinstance(s, dict)] if isinstance(loaded, list) else []


def _cited_indices(answer: str, claims: list[dict[str, Any]]) -> set[int]:
    """1-based source indices referenced by `[source:N]` markers or claim.source_index."""
    indices = {int(n) for n in _SOURCE_MARKER_RE.findall(answer or "")}
    for claim in claims:
        idx = claim.get("source_index") if isinstance(claim, dict) else None
        if isinstance(idx, int):
            indices.add(idx)
    return indices


def _receipt_sources(sources: list[dict[str, Any]], indices: set[int]) -> list[dict[str, Any]]:
    """Build the receipt's `sources` list — only entries actually cited."""
    result: list[dict[str, Any]] = []
    for i, source in enumerate(sources, start=1):
        if i not in indices:
            continue
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        content = str(source.get("content") or source.get("excerpt") or "")
        result.append(
            {
                "index": i,
                "document_name": source.get("document_name") or metadata.get("document_name"),
                "page_number": source.get("page_number", metadata.get("page_number")),
                "excerpt": content[:EXCERPT_MAX_CHARS],
                "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            }
        )
    return result


def build_payload(query: Query, claims: list[dict[str, Any]], workspace: Workspace) -> dict[str, Any]:
    """Build the canonical Truth Receipt payload for a finished query."""
    answer = query.response_text or ""
    sources = _load_sources(query)
    indices = _cited_indices(answer, claims)
    return {
        "version": RECEIPT_VERSION,
        "question": query.query_text,
        "answer": answer,
        "claims": claims,
        "sources": _receipt_sources(sources, indices),
        "trust": {"score": query.trust_score, "components": query.trust_components or {}},
        "guardrail": {"passed": query.guardrail_passed, "score": query.guardrail_score},
        "model_used": query.model_used,
        "prompt_version": query.prompt_version,
        "workspace_name": workspace.name,
        "asked_at": utc_iso(query.created_at),
        "issued_at": utc_iso(datetime.now(timezone.utc)),
        "issuer": ISSUER,
    }


def canonicalize(payload: dict[str, Any]) -> str:
    """Deterministic JSON encoding the seal is computed over."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _signing_key() -> bytes:
    return hashlib.sha256(b"tl-receipt|" + settings.APP_SECRET_KEY.encode("utf-8")).digest()


def seal_and_sign(canonical: str) -> tuple[str, str]:
    """Return `(seal, signature)` for a canonical payload string."""
    seal = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    signature = hmac.new(_signing_key(), seal.encode("utf-8"), hashlib.sha256).hexdigest()
    return seal, signature


def verify(receipt: Receipt) -> tuple[bool, bool]:
    """Recompute seal/signature validity from a receipt's stored fields.

    `seal_valid` requires the stored `payload` to canonicalize back to the
    stored `canonical` *and* that canonical's hash to match the stored
    `seal` — so tampering either `payload` or `canonical` alone is caught.
    `signature_valid` is independent: it only checks that `signature` is a
    valid HMAC over the stored `seal` (a corrupted/replaced seal fails this
    even if the payload/canonical pair is internally consistent).
    """
    seal_valid = False
    try:
        payload_obj = json.loads(receipt.payload)
        if canonicalize(payload_obj) == receipt.canonical:
            seal_valid = hashlib.sha256(receipt.canonical.encode("utf-8")).hexdigest() == receipt.seal
    except (json.JSONDecodeError, TypeError, ValueError):
        seal_valid = False

    recomputed_signature = hmac.new(_signing_key(), receipt.seal.encode("utf-8"), hashlib.sha256).hexdigest()
    signature_valid = hmac.compare_digest(recomputed_signature, receipt.signature)
    return seal_valid, signature_valid
