"""Unit tests for the Truth Receipt service (app/receipts.py).

Pure-function tests: build_payload/canonicalize/seal_and_sign/verify operate on
plain (unpersisted) ORM instances, no DB round trip needed.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.query import Query
from app.models.receipt import Receipt
from app.models.workspace import Workspace
from app.receipts import build_payload, canonicalize, revoke_receipts_for_document, seal_and_sign, verify


def _make_query(**overrides) -> Query:
    defaults: dict = dict(
        id="q1",
        workspace_id="w1",
        query_text="What powers Northwind's turbines?",
        response_text="Wind powers the turbines [source:1].",
        response_sources=json.dumps(
            [
                {
                    "chunk_id": "c1",
                    "document_id": "d1",
                    "document_name": "spec.pdf",
                    "content": "Wind turbines generate power from wind.",
                    "page_number": 2,
                },
                {
                    "chunk_id": "c2",
                    "document_id": "d2",
                    "document_name": "other.pdf",
                    "content": "Unrelated content.",
                    "page_number": 5,
                },
            ]
        ),
        trust_score=0.9,
        trust_components={"retrieval": 0.9},
        guardrail_score=0.95,
        guardrail_passed=True,
        model_used="qwen3:4b",
        prompt_version="abc123",
        edge_case=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    defaults.update(overrides)
    return Query(**defaults)


def _make_workspace(**overrides) -> Workspace:
    defaults: dict = dict(id="w1", name="Northwind Renewables", owner_id="u1")
    defaults.update(overrides)
    return Workspace(**defaults)


class TestBuildPayload:
    def test_basic_fields(self):
        query = _make_query()
        payload = build_payload(query, claims=[], workspace=_make_workspace())

        assert payload["version"] == "tl-receipt/1"
        assert payload["question"] == query.query_text
        assert payload["answer"] == query.response_text
        assert payload["workspace_name"] == "Northwind Renewables"
        assert payload["model_used"] == "qwen3:4b"
        assert payload["prompt_version"] == "abc123"
        assert payload["trust"] == {"score": 0.9, "components": {"retrieval": 0.9}}
        assert payload["guardrail"] == {"passed": True, "score": 0.95}
        assert payload["asked_at"] == "2026-01-01T00:00:00+00:00"
        assert payload["claims"] == []
        assert "issued_at" in payload

    def test_includes_only_sources_cited_by_marker(self):
        query = _make_query()
        payload = build_payload(query, claims=[], workspace=_make_workspace())

        assert len(payload["sources"]) == 1
        source = payload["sources"][0]
        assert source["index"] == 1
        assert source["document_id"] == "d1"
        assert source["document_name"] == "spec.pdf"
        assert source["page_number"] == 2
        assert source["excerpt"] == "Wind turbines generate power from wind."
        assert source["content_sha256"] == hashlib.sha256(
            b"Wind turbines generate power from wind."
        ).hexdigest()

    def test_includes_source_referenced_only_by_claim_source_index(self):
        query = _make_query(response_text="Wind is the cause of it.")
        claims = [
            {
                "text": "Wind is the cause of it.",
                "verdict": "supported",
                "source_index": 2,
            }
        ]
        payload = build_payload(query, claims=claims, workspace=_make_workspace())

        assert [s["index"] for s in payload["sources"]] == [2]
        assert payload["sources"][0]["document_name"] == "other.pdf"

    def test_excerpt_truncated_to_1200_chars_but_hash_covers_full_content(self):
        long_content = "x" * 2000
        query = _make_query(
            response_text="Answer [source:1].",
            response_sources=json.dumps(
                [{"chunk_id": "c1", "document_name": "big.pdf", "content": long_content}]
            ),
        )
        payload = build_payload(query, claims=[], workspace=_make_workspace())
        source = payload["sources"][0]
        assert len(source["excerpt"]) == 1200
        assert source["content_sha256"] == hashlib.sha256(long_content.encode("utf-8")).hexdigest()

    def test_no_citations_yields_no_sources(self):
        query = _make_query(response_text="No citation markers here.")
        payload = build_payload(query, claims=[], workspace=_make_workspace())
        assert payload["sources"] == []


class TestCanonicalize:
    def test_deterministic_regardless_of_key_order(self):
        a = canonicalize({"b": 1, "a": 2})
        b = canonicalize({"a": 2, "b": 1})
        assert a == b

    def test_compact_separators(self):
        out = canonicalize({"a": 1})
        assert " " not in out


class TestSealAndVerify:
    def _sealed_receipt(self) -> Receipt:
        query = _make_query()
        payload = build_payload(query, claims=[], workspace=_make_workspace())
        canonical = canonicalize(payload)
        seal, signature = seal_and_sign(canonical)
        return Receipt(
            id="r1",
            token="tok",
            query_id="q1",
            workspace_id="w1",
            created_by="u1",
            payload=json.dumps(payload),
            canonical=canonical,
            seal=seal,
            signature=signature,
        )

    def test_fresh_receipt_verifies_both_valid(self):
        receipt = self._sealed_receipt()
        seal_valid, signature_valid = verify(receipt)
        assert seal_valid is True
        assert signature_valid is True

    def test_tampered_canonical_fails_seal(self):
        receipt = self._sealed_receipt()
        receipt.canonical = receipt.canonical.replace("Northwind", "Tampered")
        seal_valid, signature_valid = verify(receipt)
        assert seal_valid is False

    def test_tampered_payload_fails_seal(self):
        receipt = self._sealed_receipt()
        payload_obj = json.loads(receipt.payload)
        payload_obj["question"] = "A different question entirely"
        receipt.payload = json.dumps(payload_obj)
        seal_valid, signature_valid = verify(receipt)
        assert seal_valid is False

    def test_tampered_seal_fails_signature(self):
        receipt = self._sealed_receipt()
        receipt.seal = "0" * 64
        seal_valid, signature_valid = verify(receipt)
        assert signature_valid is False


class TestRevokeReceiptsForDocument:
    """`revoke_receipts_for_document` — used when a document is deleted (single or
    bulk) so a public receipt never keeps quoting evidence that no longer exists."""

    def _receipt(self, *, workspace_id: str, sources: list[dict], revoked_at=None) -> Receipt:
        query = _make_query(
            id=f"q-{uuid.uuid4().hex[:8]}",
            workspace_id=workspace_id,
            response_sources=json.dumps(sources),
        )
        payload = build_payload(query, claims=[], workspace=_make_workspace(id=workspace_id))
        canonical = canonicalize(payload)
        seal, signature = seal_and_sign(canonical)
        return Receipt(
            id=f"r-{uuid.uuid4().hex[:8]}",
            token=f"tok-{uuid.uuid4().hex[:8]}",
            query_id=query.id,
            workspace_id=workspace_id,
            created_by=None,
            payload=json.dumps(payload),
            canonical=canonical,
            seal=seal,
            signature=signature,
            revoked_at=revoked_at,
        )

    @pytest.mark.asyncio
    async def test_revokes_receipt_citing_document_by_id(self, test_db: AsyncSession):
        receipt = self._receipt(
            workspace_id="ws1",
            sources=[{"chunk_id": "c1", "document_id": "doc-1", "document_name": "spec.pdf", "content": "text"}],
        )
        test_db.add(receipt)
        await test_db.commit()

        count = await revoke_receipts_for_document(
            test_db, workspace_id="ws1", document_id="doc-1", document_name="spec.pdf"
        )
        await test_db.commit()

        assert count == 1
        await test_db.refresh(receipt)
        assert receipt.revoked_at is not None

    @pytest.mark.asyncio
    async def test_falls_back_to_document_name_when_payload_predates_document_id(self, test_db: AsyncSession):
        """A receipt sealed before `document_id` was stored in the payload still gets revoked."""
        receipt = self._receipt(
            workspace_id="ws2",
            sources=[{"chunk_id": "c1", "document_id": "doc-2", "document_name": "legacy.pdf", "content": "text"}],
        )
        payload = json.loads(receipt.payload)
        for source in payload["sources"]:
            source.pop("document_id", None)
        receipt.payload = json.dumps(payload)
        test_db.add(receipt)
        await test_db.commit()

        count = await revoke_receipts_for_document(
            test_db, workspace_id="ws2", document_id="doc-2", document_name="legacy.pdf"
        )
        await test_db.commit()

        assert count == 1
        await test_db.refresh(receipt)
        assert receipt.revoked_at is not None

    @pytest.mark.asyncio
    async def test_does_not_revoke_receipts_citing_a_different_document(self, test_db: AsyncSession):
        receipt = self._receipt(
            workspace_id="ws3",
            sources=[{"chunk_id": "c1", "document_id": "other-doc", "document_name": "other.pdf", "content": "text"}],
        )
        test_db.add(receipt)
        await test_db.commit()

        count = await revoke_receipts_for_document(
            test_db, workspace_id="ws3", document_id="doc-3", document_name="unrelated.pdf"
        )

        assert count == 0
        await test_db.refresh(receipt)
        assert receipt.revoked_at is None

    @pytest.mark.asyncio
    async def test_already_revoked_receipts_are_left_alone(self, test_db: AsyncSession):
        original = datetime(2020, 1, 1, tzinfo=timezone.utc)
        receipt = self._receipt(
            workspace_id="ws4",
            sources=[{"chunk_id": "c1", "document_id": "doc-4", "document_name": "x.pdf", "content": "text"}],
            revoked_at=original,
        )
        test_db.add(receipt)
        await test_db.commit()

        count = await revoke_receipts_for_document(test_db, workspace_id="ws4", document_id="doc-4")

        assert count == 0
        # Untouched — assert on the in-memory value directly rather than a
        # round-tripped `refresh()`, which would lose tzinfo on SQLite.
        assert receipt.revoked_at == original
