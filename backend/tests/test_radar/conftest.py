"""Shared fakes for Contradiction Radar tests.

The scan touches three heavy things — Chroma, the sentence embedder and the NLI
cross-encoder. Each is replaced with a tiny deterministic fake so the tests pin
the scan's own logic (neighbour filtering, dedupe, thresholds, persistence).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.fixture(autouse=True)
def _point_app_db_at_test_engine(monkeypatch, test_engine):
    """The scan opens its own sessions through `app.database.async_session_factory`."""
    import app.database as db_module

    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "async_session_factory", factory)
    yield


def unit(*values: float) -> list[float]:
    vec = np.array(values, dtype=np.float32)
    return (vec / np.linalg.norm(vec)).tolist()


class FakeCollection:
    """Just enough of `chromadb.Collection` for the radar: `get` + `query`.

    Honours the `where` filters the radar sends (`$in`, `$ne`, equality) and
    ranks `query` hits by cosine distance, so a scan that forgot the
    other-document filter would see its own chunks come back.
    """

    def __init__(self, records: list[dict[str, Any]]) -> None:
        # record: {id, document_id, document_name, chunk_id, text, embedding, page_number?}
        self.records = records
        self.get_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []

    @staticmethod
    def _match(meta: dict[str, Any], where: dict[str, Any] | None) -> bool:
        if not where:
            return True
        for key, cond in where.items():
            value = meta.get(key)
            if isinstance(cond, dict):
                if "$in" in cond and value not in cond["$in"]:
                    return False
                if "$ne" in cond and value == cond["$ne"]:
                    return False
            elif value != cond:
                return False
        return True

    def _meta(self, rec: dict[str, Any]) -> dict[str, Any]:
        meta = {
            "document_id": rec["document_id"],
            "document_name": rec.get("document_name", ""),
            "chunk_id": rec["chunk_id"],
        }
        if rec.get("page_number") is not None:
            meta["page_number"] = rec["page_number"]
        return meta

    def get(self, where=None, include=None, limit=None, **_: Any) -> dict[str, Any]:
        self.get_calls.append({"where": where, "include": include, "limit": limit})
        hits = [r for r in self.records if self._match(self._meta(r), where)]
        if limit is not None:
            hits = hits[:limit]
        return {
            "ids": [r["id"] for r in hits],
            "embeddings": [r["embedding"] for r in hits],
            "documents": [r["text"] for r in hits],
            "metadatas": [self._meta(r) for r in hits],
        }

    def query(self, query_embeddings, n_results=10, where=None, include=None, **_: Any) -> dict[str, Any]:
        self.query_calls.append({"n": len(query_embeddings), "n_results": n_results, "where": where})
        out: dict[str, list] = {"ids": [], "documents": [], "metadatas": [], "distances": []}
        for emb in query_embeddings:
            q = np.array(emb, dtype=np.float32)
            scored = [
                (1.0 - float(np.dot(q, np.array(r["embedding"], dtype=np.float32))), r)
                for r in self.records
                if self._match(self._meta(r), where)
            ]
            scored.sort(key=lambda pair: pair[0])
            scored = scored[:n_results]
            out["ids"].append([r["id"] for _, r in scored])
            out["documents"].append([r["text"] for _, r in scored])
            out["metadatas"].append([self._meta(r) for _, r in scored])
            out["distances"].append([d for d, _ in scored])
        return out


def keyword_embed(sentences: list[str]) -> np.ndarray:
    """Sentence 'embedder': same topic keyword -> same direction."""
    topics = ["revenue", "employ", "ceo"]
    rows = []
    for s in sentences:
        vec = [1.0 if t in s.lower() else 0.0 for t in topics] + [0.01]
        rows.append(unit(*vec))
    return np.array(rows, dtype=np.float32)


class FakeNLI:
    """Contradiction when two sentences share a topic but differ; entailment when equal."""

    def __init__(self, contradiction: float = 0.95, entailment: float = 0.97) -> None:
        self.contradiction = contradiction
        self.entailment = entailment
        self.calls: list[list[tuple[str, str]]] = []

    def __call__(self, pairs: list[tuple[str, str]]) -> list[tuple[float, float, float]]:
        self.calls.append(list(pairs))
        scores = []
        for premise, hypothesis in pairs:
            same_topic = any(t in premise.lower() and t in hypothesis.lower() for t in ("revenue", "employ", "ceo"))
            if premise == hypothesis:
                scores.append((self.entailment, 1 - self.entailment, 0.0))
            elif same_topic:
                rest = 1 - self.contradiction
                scores.append((rest / 2, rest / 2, self.contradiction))
            else:
                scores.append((0.05, 0.9, 0.05))
        return scores
