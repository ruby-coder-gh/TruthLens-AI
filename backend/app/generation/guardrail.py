"""NLI-based hallucination detection on generated answer."""

from __future__ import annotations

import asyncio
import re
from functools import lru_cache
from typing import Any

from app.config import settings
from app.retrieval.sufficiency import REFUSAL_PREFIX
from app.utils.logger import logger

# ─── Truth Lens per-claim verdicts ──────────────────────────────
# Calibrated against cross-encoder/nli-deberta-v3-base on a 24-claim golden
# set (tests/test_generation/test_guardrail_nli_eval.py). `supported` also
# needs the entailment ratio to clear settings.GUARDRAIL_THRESHOLD.
SUPPORTED_MIN_ENTAILMENT = 0.5
CONTRADICTED_MIN_CONTRADICTION = 0.6
CONTRADICTED_MAX_ENTAILMENT = 0.3
PARTIAL_MIN_RATIO = 0.5
PARTIAL_MIN_ENTAILMENT = 0.3
# A context that lacks a number the claim states can at most make it
# "partial": deberta will "entail" $52M from $48.2M.
NUMERIC_MISMATCH_MAX_ENTAILMENT = 0.29
# deberta goes neutral on long multi-sentence premises, so each chunk is also
# scored through its best-overlap sentence window when that window shares at
# least this many content words with the claim.
WINDOW_MIN_OVERLAP = 2
# ponytail: hard caps bound the batch at 12x8x2 pairs; raise with a GPU.
MAX_CLAIMS = 12
MAX_CONTEXTS = 8
EVIDENCE_MAX_CHARS = 400

_MARKER_RE = re.compile(r"\s*\[source:\s*(\d+)\]")
# A claim ends at .!? (keeping any [source:N] markers right after it) when the
# next sentence starts with a capital/quote/paren, and always at a line break.
_CLAIM_END_RE = re.compile(r"[.!?]+(?:\s*\[source:\s*\d+\])*(?=\s+[A-Z\"'(*]|\s*$)|\r?\n")
# Markdown heading / bullet / numbered-list / quote prefixes a claim span skips.
_LIST_PREFIX_RE = re.compile(r"\s*(?:(?:#{1,6}|[-*+•>]|\d+[.)])\s+)*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n\s*\n")
_WORD_RE = re.compile(r"[a-z0-9]+(?:\.\d+)?")
_NUMBER_RE = re.compile(r"(?<![A-Za-z])\d+(?:[.,]\d+)*")
_STOPWORDS = frozenset(
    "a an the and or but of to in on at for from by with as is are was were be been being "
    "it its this that these those has have had do does did not no than then so such".split()
)


class GuardrailResult:
    """Result of guardrail check."""

    def __init__(
        self,
        passed: bool = True,
        score: float = 1.0,
        unsupported_claims: list[str] | None = None,
        details: str = "",
        claims: list[dict[str, Any]] | None = None,
        unchecked_claims: int = 0,
    ) -> None:
        self.passed = passed
        self.score = score
        self.unsupported_claims = unsupported_claims or []
        self.details = details
        # Truth Lens claim objects (see `_claim_object`); [] when not verified.
        self.claims = claims or []
        # How many claims the MAX_CLAIMS cap dropped from checking (0 when uncapped).
        self.unchecked_claims = unchecked_claims


@lru_cache(maxsize=1)
def _load_nli_model(model_name: str | None = None) -> Any:
    """Load NLI model for entailment checking."""
    name = model_name or settings.GUARDRAIL_NLI_MODEL
    logger.info("loading_nli_model", model=name)
    try:
        from sentence_transformers import CrossEncoder
        return CrossEncoder(name, device=settings.EMBED_DEVICE)
    except Exception as e:
        logger.warning("nli_model_load_failed", model=name, error=str(e))
        return None


def _extract_claims(answer: str) -> list[str]:
    """Split answer into individual claims (sentences)."""
    # Replace newlines, handle end-of-sentence punctuation
    text = answer.replace("\n", " ")
    claims = re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", text)
    # If no splits, try simpler split on sentence punctuation
    if len(claims) <= 1:
        claims = re.split(r"(?<=[.!?]) ", text)
    if len(claims) <= 1:
        # Fallback to splitting on all sentence-ending punctuation
        claims = re.split(r"[.!?]+", text)
        claims = [c.strip() + "." for c in claims if c.strip()]
    # Filter out very short fragments and source markers
    filtered = []
    for c in claims:
        c = c.strip()
        if len(c) > 15 and not c.startswith("[source"):
            filtered.append(c)
    return filtered


def _extract_claim_spans(answer: str) -> list[tuple[str, int, int]]:
    """Split an answer into claims with `[start, end)` offsets into `answer`.

    Unlike `_extract_claims`, line breaks (bullets, headings) always end a
    claim, trailing `[source:N]` markers stay inside the span, and the returned
    text has markers stripped (it is the NLI hypothesis).
    """
    spans: list[tuple[str, int, int]] = []
    start = 0
    for match in [*_CLAIM_END_RE.finditer(answer), None]:
        if match is None:
            end = nxt = len(answer)
        elif match.group().endswith("\n"):
            end, nxt = match.start(), match.end()
        else:
            end = nxt = match.end()
        segment = answer[start:end]
        span_start = start + _LIST_PREFIX_RE.match(segment).end()
        span_end = start + len(segment.rstrip())
        text = _MARKER_RE.sub("", answer[span_start:span_end]).replace("**", "").strip()
        if len(text) > 15:
            spans.append((text, span_start, span_end))
        start = nxt
    return spans


def _verdict(entailment: float, ratio: float, max_contradiction: float) -> str:
    """Map a claim's best-support entailment/ratio and worst contradiction to a verdict."""
    if entailment >= SUPPORTED_MIN_ENTAILMENT and ratio >= settings.GUARDRAIL_THRESHOLD:
        return "supported"
    if max_contradiction >= CONTRADICTED_MIN_CONTRADICTION and entailment < CONTRADICTED_MAX_ENTAILMENT:
        return "contradicted"
    if ratio >= PARTIAL_MIN_RATIO or entailment >= PARTIAL_MIN_ENTAILMENT:
        return "partial"
    return "unsupported"


def _sentences(text: str) -> list[str]:
    return [" ".join(s.split()) for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def _words(text: str) -> set[str]:
    # Single letters are possessive/contraction debris ("Northwind's" -> "s"), except digits.
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS and (len(w) > 1 or w.isdigit())}


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in _NUMBER_RE.findall(text)}


def _context_text(ctx: dict[str, Any]) -> str:
    content = ctx.get("content", ctx.get("text", ""))
    return content if isinstance(content, str) else ""


_DOC_EXT_RE = re.compile(r"\.(pdf|docx|txt|md|csv|json)$", re.IGNORECASE)


def _premise_prefix(ctx: dict[str, Any]) -> str:
    """Document title to prepend to a premise.

    Chunks rarely name their subject ("Revenue in 2025 was €412 million."), so NLI
    can't confirm "Northwind's revenue was €412M" from them (entailment ~0.00);
    with the title in front it does (~0.998) and catches "€398M" as a
    contradiction (~0.995).
    """
    name = ctx.get("document_name") or (ctx.get("metadata") or {}).get("document_name") or ""
    title = _DOC_EXT_RE.sub("", str(name)).strip()
    return f"{title}: " if title else ""


def _claim_object(
    text: str, start: int, end: int, verdict: str, entailment: float, contradiction: float,
    index: int, ctx: dict[str, Any], evidence: str,
) -> dict[str, Any]:
    """The Truth Lens claim contract (WS `guardrail.claims`, REST, receipts)."""
    metadata = ctx.get("metadata") if isinstance(ctx.get("metadata"), dict) else {}
    page = ctx.get("page_number") or metadata.get("page_number")
    return {
        "text": text,
        "start": start,
        "end": end,
        "verdict": verdict,
        "entailment": round(entailment, 4),
        "contradiction": round(contradiction, 4),
        "source_index": index + 1,
        "chunk_id": str(ctx["chunk_id"]) if ctx.get("chunk_id") else None,
        "document_id": str(ctx["document_id"]) if ctx.get("document_id") else None,
        "document_name": ctx.get("document_name") or metadata.get("document_name") or None,
        "page_number": int(page) if isinstance(page, (int, float)) and not isinstance(page, bool) else None,
        "evidence": evidence[:EVIDENCE_MAX_CHARS] or None,
    }


def _softmax(logits: list[float]) -> list[float]:
    """Convert logits to probabilities via softmax."""
    import math
    exps = [math.exp(x) for x in logits]
    total = sum(exps)
    return [e / total for e in exps]


_UNIFORM_NLI_SCORE: tuple[float, float, float] = (0.33, 0.34, 0.33)


def _reorder(logits: list[float]) -> tuple[float, float, float]:
    """Softmax raw 3-class logits and reorder to (entailment, neutral, contradiction).

    Model output order: [contradiction(0), entailment(1), neutral(2)].
    """
    scores = _softmax(logits)
    return scores[1], scores[2], scores[0]


def _nli_infer(model: Any, premise: str, hypothesis: str) -> tuple[float, float, float]:
    """Run NLI inference. Returns (entailment, neutral, contradiction) probabilities."""
    try:
        pair = [premise, hypothesis]
        result = model.predict([pair])
        if len(result.shape) == 1 and result.shape[0] == 3:
            return _reorder(result.tolist())
        elif len(result.shape) == 2 and result.shape[1] == 3:
            return _reorder(result[0].tolist())
        else:
            scores = result.flatten().tolist()
            if len(scores) >= 3:
                return _reorder(scores)
    except Exception as e:
        logger.warning("nli_inference_failed", error=str(e))

    return _UNIFORM_NLI_SCORE  # Uniform on failure


def nli_batch(pairs: list[tuple[str, str]]) -> list[tuple[float, float, float]]:
    """Batch NLI inference over premise/hypothesis pairs.

    Unlike `_nli_infer` (one pair per `model.predict` call), this issues a
    single `model.predict` call for the whole batch, then softmaxes and
    reorders each row's logits into (entailment, neutral, contradiction) —
    same convention as `_nli_infer`.

    Sync — callers must wrap in `asyncio.to_thread`.

    Returns `[]` for empty input. Falls back to a uniform
    `(0.33, 0.34, 0.33)` per pair (and logs a warning) if the model isn't
    loaded or `predict` raises.
    """
    if not pairs:
        return []

    model = _load_nli_model()
    if model is None:
        logger.warning("nli_batch_model_unavailable", pair_count=len(pairs))
        return [_UNIFORM_NLI_SCORE] * len(pairs)

    try:
        rows = model.predict([[premise, hypothesis] for premise, hypothesis in pairs])
        scores = [_reorder(row.tolist() if hasattr(row, "tolist") else list(row)) for row in rows]
        if len(scores) != len(pairs):
            raise ValueError(f"predict returned {len(scores)} rows for {len(pairs)} pairs")
        return scores
    except Exception as e:
        logger.warning("nli_batch_inference_failed", error=str(e), pair_count=len(pairs))
        return [_UNIFORM_NLI_SCORE] * len(pairs)


async def check(answer: str, contexts: list[dict[str, Any]]) -> GuardrailResult:
    """Check generated answer against source contexts for hallucination.

    Every claim is scored against every context separately (one batched NLI
    call), so a late chunk can't be truncated away as it was when all contexts
    were merged into one 512-token premise. Each claim gets a verdict, the
    chunk it rests on and an evidence sentence (Truth Lens).

    Args:
        answer: Generated answer text (the persisted `response_text`).
        contexts: Retrieved context chunks, in `[source:N]` order.

    Returns:
        GuardrailResult; `score` is the lowest per-claim entailment ratio.
    """
    if not answer or not contexts:
        return GuardrailResult(passed=True, score=1.0, details="No answer or context to check")

    model = await asyncio.to_thread(_load_nli_model)
    if model is None:
        return GuardrailResult(passed=True, score=1.0, details="NLI model not available - skipping guardrail")

    # (position in `contexts`, context, text) — position keeps `[source:N]` numbering.
    scored = [
        (i, ctx, text) for i, ctx in enumerate(contexts[:MAX_CONTEXTS]) if (text := _context_text(ctx)).strip()
    ]
    if not scored:
        return GuardrailResult(passed=True, score=1.0, details="No context text available")

    # The generator's own "can't answer" sentence is not a claim about the documents.
    spans = [s for s in _extract_claim_spans(answer) if not s[0].lower().startswith(REFUSAL_PREFIX.lower())]
    if not spans:
        return GuardrailResult(passed=True, score=1.0, details="No claims to check")
    total_claims = len(spans)
    if len(spans) > MAX_CLAIMS or len(contexts) > MAX_CONTEXTS:
        logger.info("guardrail_claims_capped", claims=len(spans), contexts=len(contexts))
        spans = spans[:MAX_CLAIMS]
    unchecked_claims = total_claims - len(spans)

    sentences = [_sentences(text) for _, _, text in scored]
    flat = [" ".join(text.split()) for _, _, text in scored]
    context_numbers = [_numbers(text) for _, _, text in scored]

    pairs: list[tuple[str, str]] = []
    owners: list[tuple[int, int]] = []
    evidence: dict[tuple[int, int], str] = {}
    related: set[tuple[int, int]] = set()
    for c, (claim, _, _) in enumerate(spans):
        claim_words, claim_numbers = _words(claim), _numbers(claim)
        for k, (_, ctx, text) in enumerate(scored):
            sents = sentences[k]
            prefix = _premise_prefix(ctx)
            # Shared numbers count twice: they pin down which sentence a claim is about.
            overlaps = [len(claim_words & _words(s)) + len(claim_numbers & _numbers(s)) for s in sents]
            best = overlaps.index(max(overlaps))
            evidence[c, k] = sents[best] if overlaps[best] else ""
            pairs.append((prefix + text, claim))
            owners.append((c, k))
            if overlaps[best] >= WINDOW_MIN_OVERLAP:
                related.add((c, k))
                window = " ".join(sents[max(0, best - 1): best + 2])
                if window != flat[k]:
                    pairs.append((prefix + window, claim))
                    owners.append((c, k))

    scores = await asyncio.to_thread(nli_batch, pairs)

    # (claim, context) -> [entailment, its contradiction, max contradiction] over that context's premises
    per: dict[tuple[int, int], list[float]] = {}
    for key, (entail, _neutral, contra) in zip(owners, scores):
        row = per.setdefault(key, [entail, contra, contra])
        if entail > row[0]:
            row[0], row[1] = entail, contra
        row[2] = max(row[2], contra)

    claims: list[dict[str, Any]] = []
    ratios: list[float] = []
    unsupported: list[str] = []
    for c, (claim, start, end) in enumerate(spans):
        claim_numbers = _numbers(claim)
        rows = []
        for k in range(len(scored)):
            entail, contra, max_contra = per[c, k]
            numbers_ok = claim_numbers <= context_numbers[k]
            if not numbers_ok:
                entail = min(entail, NUMERIC_MISMATCH_MAX_ENTAILMENT)
            # NLI labels unrelated text "contradiction" (SNLI artefact): only a
            # chunk that shares words with the claim may contradict it.
            if (c, k) not in related:
                max_contra = 0.0
            rows.append((entail, contra, max_contra, numbers_ok))

        best = max(range(len(rows)), key=lambda k: rows[k][0])
        entail, contra, _, numbers_ok = rows[best]
        ratio = entail / (entail + contra) if entail + contra > 0 else 0.5
        if not numbers_ok:
            ratio = min(ratio, PARTIAL_MIN_RATIO)
        worst = max(range(len(rows)), key=lambda k: rows[k][2])
        verdict = _verdict(entail, ratio, rows[worst][2])

        chosen = best
        if verdict == "contradicted":
            chosen = worst
        elif verdict == "unsupported":
            # Nothing supports it: point at the source the answer itself cited.
            cited = _MARKER_RE.search(answer, start, end)
            positions = [i for i, _, _ in scored]
            if cited and int(cited.group(1)) - 1 in positions:
                chosen = positions.index(int(cited.group(1)) - 1)

        chosen_entail, chosen_contra, chosen_max_contra, _ = rows[chosen]
        index, ctx, _ = scored[chosen]
        claims.append(_claim_object(
            claim, start, end, verdict, chosen_entail,
            chosen_max_contra if verdict == "contradicted" else chosen_contra,
            index, ctx, evidence[c, chosen],
        ))
        ratios.append(ratio)
        if verdict in ("unsupported", "contradicted"):
            unsupported.append(claim)

    overall_score = min(ratios)
    threshold = settings.GUARDRAIL_THRESHOLD
    passed = overall_score >= threshold
    counts = {v: sum(1 for cl in claims if cl["verdict"] == v) for v in ("supported", "partial", "unsupported", "contradicted")}
    details = (
        f"{counts['supported']}/{len(claims)} claims supported, {counts['partial']} partial, "
        f"{counts['unsupported']} unsupported, {counts['contradicted']} contradicted. "
        f"Min entailment: {overall_score:.3f} (threshold: {threshold})."
    )
    if unchecked_claims:
        details = f"Checked {len(claims)} of {total_claims} claims (MAX_CLAIMS cap). " + details

    logger.info(
        "guardrail_check_complete",
        passed=passed,
        score=overall_score,
        threshold=threshold,
        total_claims=len(claims),
        nli_pairs=len(pairs),
        **counts,
    )
    return GuardrailResult(
        passed=passed,
        score=overall_score,
        unsupported_claims=unsupported,
        details=details,
        claims=claims,
        unchecked_claims=unchecked_claims,
    )
