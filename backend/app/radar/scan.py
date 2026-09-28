"""Contradiction Radar scan runner — stub owned by lane L5."""

from __future__ import annotations


async def run_scan(
    workspace_id: str,
    document_ids: list[str] | None = None,
    created_by: str | None = None,
) -> str:
    """Run a Contradiction Radar scan over a workspace and return the scan id.

    Contract (lane L5 fills this in):
    - Creates a `RadarScan` row (`status="queued"`, then `"running"`) scoped
      to `document_ids` (or the whole workspace when `None`).
    - Pulls chunk embeddings from Chroma, checks `RADAR_NEIGHBOURS` nearest
      neighbours per chunk (in *other* documents), filters by
      `RADAR_MIN_SIMILARITY`, runs `guardrail.nli_batch` both directions on
      top `RADAR_SENTENCE_PAIRS` sentence pairs, and flags pairs clearing
      `RADAR_MIN_CONTRADICTION` as `Contradiction` rows (deduped by
      `pair_key`).
    - Marks the scan `"done"` (or `"failed"` with `error` set) and stamps
      `started_at` / `finished_at`.
    - Returns the `RadarScan.id`.
    """
    raise NotImplementedError("lane L5")
