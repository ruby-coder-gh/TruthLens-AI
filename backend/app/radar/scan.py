"""Contradiction Radar scan runner.

A scan walks the workspace's chunk embeddings in Chroma, pairs each chunk with
its nearest neighbours in *other* documents, lines up the most similar
sentences of each pair, and asks the NLI cross-encoder (both directions)
whether they contradict. Flagged pairs become `Contradiction` rows, deduped by
`pair_key` so a rescan never resurrects a dismissed finding.

All Chroma / embedder / NLI work runs in worker threads; the event loop only
does the DB writes, which also publish progress (`chunks_scanned`,
`pairs_checked`, `found`) for the UI to poll.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app import database
from app.api.stream_registry import track_task
from app.chroma_client import get_workspace_collection
from app.config import settings
from app.core.exceptions import ConflictException
from app.generation.guardrail import nli_batch
from app.models.contradiction import Contradiction
from app.models.radar_scan import RadarScan
from app.utils.logger import logger

ACTIVE_STATUSES = ("queued", "running")
# A scan row still "running" after this long was orphaned by a crash/restart;
# it no longer blocks new scans.
STALE_AFTER = timedelta(hours=1)
# Chunk pairs scored per worker-thread round; each round commits progress.
PAIR_BATCH = 32
MIN_SENTENCE_CHARS = 20
MAX_SENTENCE_CHARS = 400
# Brief said 0.5; raised after a real-model eval (bge-base + nli-deberta-v3-base):
# planted conflicts paired at cosine 0.65-0.88, while an unrelated sentence at
# 0.56 drew a 0.99 NLI "contradiction".
MIN_SENTENCE_SIMILARITY = 0.6

MIN_SENTENCE_WORDS = 4
# Jaccard overlap of the two sentences' content words (numbers, dates and
# stopwords removed). Tuned on the demo corpus: planted conflicts share their
# subject (0.67-1.0); NLI's other >= 0.87 pairs were same-topic sentences about
# something else (group capex guidance vs project capex estimate, 0.0-0.19).
MIN_SUBJECT_OVERLAP = 0.34

# A line break before a lowercase letter, digit or "(" continues a hard-wrapped
# sentence; any other line break (heading, label, list item, table row) ends one.
_SOFT_WRAP = re.compile(r"[ \t]*\n[ \t]*(?=[a-z0-9(])")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\n")
_LEADING_MARKUP = re.compile(r"^[-*•#|>\s]+")
_EMPHASIS = re.compile(r"\*\*|__")
# Only whole sentences: headings, titles and chunk-boundary fragments carry no
# claim, and NLI calls two different titles a 0.99 contradiction.
_TERMINATED = re.compile(r"[.!?][\"')\]]*$")
_WORD = re.compile(r"[a-z]+")
# Function words, plus month names: a date is the value a conflict differs in
# ("in March 2021" vs "in January 2022"), not part of its subject.
_NOT_SUBJECT = frozenset(
    "a about after also an and are as at be been before being but by can could did do does for from "
    "had has have he her his if in into is it its more most not now of on or our over per she so than "
    "that the their them then there these they this those through to under up was we were what when "
    "which while who will with would year years "
    "january february march april may june july august september october november december".split()
)

# Process-local scan tasks and the documents queued behind them (auto-scans
# that arrived while one was running).
_tasks: dict[str, asyncio.Task[None]] = {}
_pending: dict[str, set[str]] = {}


class ScanActive(ConflictException):
    def __init__(self) -> None:
        super().__init__("A contradiction scan is already running for this workspace")


@dataclass(frozen=True)
class _Chunk:
    chunk_id: str
    document_id: str
    text: str


@dataclass(frozen=True)
class _Finding:
    pair_key: str
    doc_a: str
    chunk_a: str
    sentence_a: str
    doc_b: str
    chunk_b: str
    sentence_b: str
    score: float
    similarity: float


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─── Public entry points ─────────────────────────────────────────────


async def run_scan(
    workspace_id: str,
    document_ids: list[str] | None = None,
    created_by: str | None = None,
) -> str:
    """Scan `workspace_id` (or just `document_ids` against the rest) to completion; returns the scan id.

    Waits out a scan this process is already running for the workspace
    instead of failing. Raises `ScanActive` (409) if another process holds one.
    """
    running = _tasks.get(workspace_id)
    if running is not None and not running.done():
        await asyncio.wait({running})
    scan_id = await _create_scan(workspace_id, document_ids, created_by)
    await _execute(scan_id)
    return scan_id


async def start_scan_task(
    workspace_id: str,
    document_ids: list[str] | None = None,
    created_by: str | None = None,
) -> str:
    """Queue a scan and run it in a tracked background task; returns the scan id at once."""
    scan_id = await _create_scan(workspace_id, document_ids, created_by)
    task = asyncio.create_task(_run_with_follow_ups(workspace_id, scan_id))
    track_task(task)
    _tasks[workspace_id] = task
    return scan_id


async def request_auto_scan(workspace_id: str, document_ids: list[str]) -> str | None:
    """Post-ingest scan of new documents; returns the scan id, or None if folded into a running scan."""
    running = _tasks.get(workspace_id)
    if running is not None and not running.done():
        _pending.setdefault(workspace_id, set()).update(document_ids)
        return None
    try:
        return await start_scan_task(workspace_id, document_ids)
    except ScanActive:
        logger.info("radar_auto_scan_skipped", workspace_id=workspace_id, reason="scan_active")
        return None


# ─── Scan lifecycle ──────────────────────────────────────────────────


async def _create_scan(workspace_id: str, document_ids: list[str] | None, created_by: str | None) -> str:
    # ponytail: check-then-insert, not a DB lock; two requests in the same
    # instant can both pass. Pair dedupe keeps the results correct regardless.
    async with database.async_session_factory() as db:
        active = await db.scalar(
            select(RadarScan.id).where(
                RadarScan.workspace_id == workspace_id,
                RadarScan.status.in_(ACTIVE_STATUSES),
                RadarScan.created_at >= _now() - STALE_AFTER,
            ).limit(1)
        )
        if active:
            raise ScanActive()
        scan = RadarScan(
            workspace_id=workspace_id,
            status="queued",
            scope=json.dumps(sorted(set(document_ids))) if document_ids else None,
            created_by=created_by,
        )
        db.add(scan)
        await db.commit()
        return scan.id


async def _run_with_follow_ups(workspace_id: str, scan_id: str) -> None:
    """Run a scan, then one more for any documents that finished ingesting meanwhile."""
    while True:
        await _execute(scan_id)
        queued = _pending.pop(workspace_id, None)
        if not queued:
            return
        try:
            scan_id = await _create_scan(workspace_id, sorted(queued), None)
        except ScanActive:
            logger.info("radar_follow_up_skipped", workspace_id=workspace_id, documents=len(queued))
            return


async def _load_scan(db: AsyncSession, scan_id: str) -> RadarScan:
    result = await db.execute(select(RadarScan).options(noload("*")).where(RadarScan.id == scan_id))
    return result.scalar_one()


async def _execute(scan_id: str) -> None:
    """Run one queued scan to `done`, or record `failed` with the error. Never raises (except cancellation)."""
    started = time.monotonic()
    try:
        async with database.async_session_factory() as db:
            scan = await _load_scan(db, scan_id)
            scan.status = "running"
            scan.started_at = _now()
            await db.commit()

            await _scan(db, scan)

            scan.status = "done"
            scan.finished_at = _now()
            await db.commit()
            logger.info(
                "radar_scan_done",
                scan_id=scan_id,
                workspace_id=scan.workspace_id,
                chunks=scan.chunks_scanned,
                pairs=scan.pairs_checked,
                found=scan.found,
                seconds=round(time.monotonic() - started, 2),
            )
    except asyncio.CancelledError:
        await _mark_failed(scan_id, "Scan was interrupted")
        raise
    except Exception as e:
        logger.error("radar_scan_failed", scan_id=scan_id, error=str(e), exc_info=True)
        await _mark_failed(scan_id, str(e) or type(e).__name__)


async def _mark_failed(scan_id: str, error: str) -> None:
    try:
        async with database.async_session_factory() as db:
            scan = await _load_scan(db, scan_id)
            scan.status = "failed"
            scan.error = error[:500]
            scan.finished_at = _now()
            await db.commit()
    except Exception as e:
        logger.error("radar_scan_mark_failed_error", scan_id=scan_id, error=str(e))


async def _scan(db: AsyncSession, scan: RadarScan) -> None:
    scope = json.loads(scan.scope) if scan.scope else None
    collection = await asyncio.to_thread(get_workspace_collection, scan.workspace_id)
    chunks = await asyncio.to_thread(_load_chunks, collection, scope)
    pairs = await asyncio.to_thread(_candidate_pairs, collection, chunks)
    scan.chunks_scanned = len(chunks)
    await db.commit()

    seen: set[str] = set()
    vectors: dict[str, np.ndarray] = {}  # sentence -> embedding, reused across batches
    for start in range(0, len(pairs), PAIR_BATCH):
        batch = pairs[start:start + PAIR_BATCH]
        findings = await asyncio.to_thread(_score_pairs, batch, vectors)
        await _persist(db, scan, findings, seen)
        scan.pairs_checked += len(batch)
        scan.found = len(seen)
        await db.commit()


async def _persist(db: AsyncSession, scan: RadarScan, findings: list[_Finding], seen: set[str]) -> None:
    fresh: dict[str, _Finding] = {}
    for finding in findings:
        if finding.pair_key not in fresh or finding.score > fresh[finding.pair_key].score:
            fresh[finding.pair_key] = finding
    if not fresh:
        return

    result = await db.execute(
        select(Contradiction).options(noload("*")).where(
            Contradiction.workspace_id == scan.workspace_id,
            Contradiction.pair_key.in_(list(fresh)),
        )
    )
    existing = {row.pair_key: row for row in result.scalars()}
    for key, f in fresh.items():
        row = existing.get(key)
        if row is None:
            db.add(Contradiction(
                workspace_id=scan.workspace_id,
                scan_id=scan.id,
                pair_key=key,
                doc_a_id=f.doc_a,
                chunk_a_id=f.chunk_a,
                sentence_a=f.sentence_a,
                doc_b_id=f.doc_b,
                chunk_b_id=f.chunk_b,
                sentence_b=f.sentence_b,
                score=f.score,
                similarity=f.similarity,
                status="open",
            ))
        elif key not in seen:
            # Known finding: its status (dismissed/resolved) is the user's and
            # stays. Only follow the chunk ids, which a reindex regenerates.
            row.chunk_a_id, row.chunk_b_id = f.chunk_a, f.chunk_b
    seen.update(fresh)


# ─── Worker-thread steps (sync) ──────────────────────────────────────


def _load_chunks(collection: Any, document_ids: list[str] | None) -> list[tuple[_Chunk, Any]]:
    """Scope chunks with their stored embeddings, capped at `RADAR_MAX_CHUNKS`."""
    cap = settings.RADAR_MAX_CHUNKS
    got = collection.get(
        where={"document_id": {"$in": list(document_ids)}} if document_ids else None,
        include=["embeddings", "documents", "metadatas"],
        limit=cap + 1,
    )
    ids = list(got["ids"])
    if len(ids) > cap:
        # ponytail: first-N by storage order; sample per document if big workspaces need fair coverage.
        logger.warning("radar_chunks_capped", cap=cap, document_ids=document_ids)
        ids = ids[:cap]
    chunks = []
    for chroma_id, text, meta, emb in zip(ids, got["documents"], got["metadatas"], got["embeddings"]):
        meta = meta or {}
        chunk = _Chunk(str(meta.get("chunk_id") or chroma_id), str(meta.get("document_id", "")), text or "")
        chunks.append((chunk, emb))
    return chunks


def _candidate_pairs(collection: Any, chunks: list[tuple[_Chunk, Any]]) -> list[tuple[float, _Chunk, _Chunk]]:
    """Each chunk's nearest neighbours in other documents above `RADAR_MIN_SIMILARITY`, as unordered pairs."""
    by_doc: dict[str, list[tuple[_Chunk, Any]]] = {}
    for chunk, emb in chunks:
        by_doc.setdefault(chunk.document_id, []).append((chunk, emb))

    best: dict[tuple[str, str], tuple[float, _Chunk, _Chunk]] = {}
    for doc_id, group in by_doc.items():
        result = collection.query(
            query_embeddings=[np.asarray(emb, dtype=np.float32) for _, emb in group],
            n_results=settings.RADAR_NEIGHBOURS,
            where={"document_id": {"$ne": doc_id}},
            include=["documents", "metadatas", "distances"],
        )
        rows = zip(group, result["ids"], result["documents"], result["metadatas"], result["distances"])
        for (chunk, _), ids, texts, metas, distances in rows:
            for chroma_id, text, meta, distance in zip(ids, texts, metas, distances):
                similarity = 1.0 - float(distance)
                if similarity < settings.RADAR_MIN_SIMILARITY:
                    continue
                meta = meta or {}
                other = _Chunk(str(meta.get("chunk_id") or chroma_id), str(meta.get("document_id", "")), text or "")
                key = (min(chunk.chunk_id, other.chunk_id), max(chunk.chunk_id, other.chunk_id))
                if key not in best or similarity > best[key][0]:
                    best[key] = (similarity, chunk, other)
    return sorted(best.values(), key=lambda pair: -pair[0])


def _sentences(text: str) -> list[str]:
    """Whole prose sentences of a chunk: no headings, labels, table rows or cut-off fragments."""
    out: list[str] = []
    for part in _SENTENCE_BREAK.split(_SOFT_WRAP.sub(" ", _EMPHASIS.sub("", text))):
        sentence = _LEADING_MARKUP.sub("", " ".join(part.split()))
        words = sentence.split()
        numeric = sum(not any(ch.isalpha() for ch in word) for word in words)
        if (
            MIN_SENTENCE_CHARS <= len(sentence) <= MAX_SENTENCE_CHARS
            and _TERMINATED.search(sentence)
            and len(words) >= MIN_SENTENCE_WORDS
            and numeric * 2 < len(words)  # mostly figures = a table row, not a claim
            and sentence not in out
        ):
            out.append(sentence)
    return out


def _subject_words(sentence: str) -> set[str]:
    return {w for w in _WORD.findall(sentence.lower()) if len(w) > 2 and w not in _NOT_SUBJECT}


def _same_subject(a: str, b: str) -> bool:
    """Do two sentences talk about the same thing? NLI alone flags any two figures on one topic.

    ponytail: bag-of-words Jaccard; misses paraphrases with no shared content
    word ("sales" vs "revenue"). A lemmatiser/synonym map would lift recall.
    """
    words_a, words_b = _subject_words(a), _subject_words(b)
    union = words_a | words_b
    return bool(union) and len(words_a & words_b) / len(union) >= MIN_SUBJECT_OVERLAP


def _embed_sentences(sentences: list[str]) -> np.ndarray:
    """Normalised sentence embeddings from the ingestion embedder (sync; worker thread only)."""
    from app.ingestion.embedder import _load_model

    vectors = _load_model().encode(sentences, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(vectors, dtype=np.float32)


def _top_sentence_pairs(similarity: np.ndarray, a: list[str], b: list[str]) -> list[tuple[int, int]]:
    """Greedy best matches (each sentence used once) above `MIN_SENTENCE_SIMILARITY` that share a subject.

    Identical sentences are skipped.
    """
    picks: list[tuple[int, int]] = []
    used_a: set[int] = set()
    used_b: set[int] = set()
    for flat in np.argsort(-similarity, axis=None):
        i, j = divmod(int(flat), similarity.shape[1])
        if similarity[i, j] < MIN_SENTENCE_SIMILARITY or len(picks) == settings.RADAR_SENTENCE_PAIRS:
            break
        if i in used_a or j in used_b or a[i] == b[j] or not _same_subject(a[i], b[j]):
            continue
        picks.append((i, j))
        used_a.add(i)
        used_b.add(j)
    return picks


def _finding(a: _Chunk, sentence_a: str, b: _Chunk, sentence_b: str, score: float, similarity: float) -> _Finding:
    """Canonical side order (by document id) so A-vs-B and B-vs-A hash to one `pair_key`.

    The key covers documents + sentences, not chunk ids: the same sentence in
    two overlapping chunks, or in a re-chunked document after reindex, is the
    same finding.
    """
    (doc_1, chunk_1, sent_1), (doc_2, chunk_2, sent_2) = sorted(
        [(a.document_id, a.chunk_id, sentence_a), (b.document_id, b.chunk_id, sentence_b)]
    )
    key = hashlib.sha1("\x1f".join((doc_1, sent_1, doc_2, sent_2)).encode()).hexdigest()
    return _Finding(key, doc_1, chunk_1, sent_1, doc_2, chunk_2, sent_2, score, similarity)


def _score_pairs(batch: list[tuple[float, _Chunk, _Chunk]], vectors: dict[str, np.ndarray]) -> list[_Finding]:
    """Line up similar sentences per chunk pair and flag the ones NLI calls contradictory."""
    sentences = {chunk.chunk_id: _sentences(chunk.text) for _, a, b in batch for chunk in (a, b)}
    missing = sorted({s for group in sentences.values() for s in group} - vectors.keys())
    if missing:
        vectors.update(zip(missing, _embed_sentences(missing)))

    nli_pairs: list[tuple[str, str]] = []
    candidates: list[tuple[float, _Chunk, str, _Chunk, str]] = []
    for similarity, a, b in batch:
        sa, sb = sentences[a.chunk_id], sentences[b.chunk_id]
        if not sa or not sb:
            continue
        matrix = np.stack([vectors[s] for s in sa]) @ np.stack([vectors[s] for s in sb]).T
        for i, j in _top_sentence_pairs(matrix, sa, sb):
            nli_pairs += [(sa[i], sb[j]), (sb[j], sa[i])]
            candidates.append((similarity, a, sa[i], b, sb[j]))
    if not nli_pairs:
        return []

    scores = nli_batch(nli_pairs)
    findings = []
    for k, (similarity, a, sentence_a, b, sentence_b) in enumerate(candidates):
        (e_ab, _, c_ab), (e_ba, _, c_ba) = scores[2 * k], scores[2 * k + 1]
        # Contradiction is symmetric: demo-corpus conflicts scored >= 0.998 both
        # ways, while NLI's false alarms were one-way (0.98 vs 0.001).
        contradiction, entailment = min(c_ab, c_ba), max(e_ab, e_ba)
        if contradiction >= settings.RADAR_MIN_CONTRADICTION and contradiction > entailment:
            findings.append(_finding(a, sentence_a, b, sentence_b, contradiction, similarity))
    return findings
