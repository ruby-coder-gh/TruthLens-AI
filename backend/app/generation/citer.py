"""Citation matching — map answer spans back to source chunks."""

from __future__ import annotations

import re
from typing import Any

from app.utils.logger import logger


class CitedSpan:
    """A span of text with its source chunk."""

    def __init__(self, text: str, chunk_id: str, start_index: int, end_index: int) -> None:
        self.text = text
        self.chunk_id = chunk_id
        self.start_index = start_index
        self.end_index = end_index


async def cite(answer: str, contexts: list[dict[str, Any]]) -> list[CitedSpan]:
    """Match answer spans back to source chunks.

    Finds [source:N] markers in the answer and maps them to chunk IDs.

    Args:
        answer: Generated answer text.
        contexts: List of context dicts with chunk_id, content, score.

    Returns:
        List of CitedSpan objects.
    """
    cited_spans: list[CitedSpan] = []

    # Build source lookup by index
    source_map: dict[int, dict[str, Any]] = {}
    for i, ctx in enumerate(contexts, 1):
        source_map[i] = ctx

    # Find [source:N] patterns
    pattern = re.compile(r"\[source:(\d+)\]")
    for match in pattern.finditer(answer):
        source_num = int(match.group(1))
        if source_num in source_map:
            ctx = source_map[source_num]
            chunk_id = ctx.get("chunk_id", ctx.get("id", ""))
            if chunk_id:
                cited_spans.append(CitedSpan(
                    text=match.group(0),
                    chunk_id=chunk_id,
                    start_index=match.start(),
                    end_index=match.end(),
                ))

    # If no explicit citations found, try semantic matching
    if not cited_spans and contexts:
        cited_spans = await _semantic_cite(answer, contexts)

    logger.info("citation_match", spans=len(cited_spans), contexts=len(contexts))
    return cited_spans


async def _semantic_cite(
    answer: str,
    contexts: list[dict[str, Any]],
) -> list[CitedSpan]:
    """Fallback: match answer sentences to most similar context chunks.

    Uses simple overlap scoring.
    """
    cited_spans: list[CitedSpan] = []
    sentences = re.split(r"(?<=[.!?])\s+", answer)

    for sentence in sentences:
        if len(sentence) < 20:
            continue

        best_score = 0.0
        best_chunk_id = ""

        for ctx in contexts:
            content = ctx.get("content", ctx.get("text", ""))
            # Simple word overlap
            sentence_words = set(sentence.lower().split())
            ctx_words = set(content.lower().split())
            if not sentence_words:
                continue
            overlap = len(sentence_words & ctx_words)
            score = overlap / len(sentence_words)

            if score > best_score and score > 0.3:
                best_score = score
                best_chunk_id = ctx.get("chunk_id", ctx.get("id", ""))

        if best_chunk_id:
            # Check if this chunk is already cited
            if not any(s.chunk_id == best_chunk_id and s.text == sentence for s in cited_spans):
                start_idx = answer.find(sentence)
                if start_idx >= 0:
                    cited_spans.append(CitedSpan(
                        text=sentence,
                        chunk_id=best_chunk_id,
                        start_index=start_idx,
                        end_index=start_idx + len(sentence),
                    ))

    return cited_spans
