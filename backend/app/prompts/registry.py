"""Resolve the active system prompt for a logical prompt name.

The registry is the single read path used by the generation call sites. It
returns the ``active`` ``PromptVersion`` row for a name, or — when no row has
been promoted yet — the code constant ``DEFAULT_SYSTEM_PROMPT`` stamped with
its computed hash. A fresh database therefore behaves exactly as it did before
prompt pinning existed, while every answer still records *which* prompt text
produced it.

Resolutions are cached in a process-local dict because generation happens on
the hot path; ``invalidate()`` is called by promote / rollback / delete.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.generation.generator import DEFAULT_SYSTEM_PROMPT
from app.models.prompt_version import PromptVersion
from app.prompts.hashing import compute_hash

DEFAULT_PROMPT_NAME = "answer"

DEFAULT_PROMPT_HASH = compute_hash(DEFAULT_SYSTEM_PROMPT)


@dataclass(frozen=True)
class ResolvedPrompt:
    """The prompt text a generation call should use, plus its provenance."""

    content: str
    hash: str
    version_id: str | None = None
    model_name: str | None = None
    is_default: bool = False


_DEFAULT_RESOLVED = ResolvedPrompt(
    content=DEFAULT_SYSTEM_PROMPT,
    hash=DEFAULT_PROMPT_HASH,
    version_id=None,
    model_name=None,
    is_default=True,
)

_cache: dict[str, ResolvedPrompt] = {}


async def get_active(db: AsyncSession, name: str = DEFAULT_PROMPT_NAME) -> ResolvedPrompt:
    """Return the active prompt for ``name``, falling back to the code default."""
    cached = _cache.get(name)
    if cached is not None:
        return cached

    row = (
        await db.execute(
            select(PromptVersion)
            .where(PromptVersion.name == name, PromptVersion.status == "active")
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if row is None:
        resolved = _DEFAULT_RESOLVED
    else:
        resolved = ResolvedPrompt(
            content=row.content,
            hash=row.content_hash,
            version_id=row.id,
            model_name=row.model_name,
            is_default=False,
        )

    _cache[name] = resolved
    return resolved


def invalidate(name: str | None = None) -> None:
    """Drop cached resolution(s). ``None`` clears every name."""
    if name is None:
        _cache.clear()
    else:
        _cache.pop(name, None)


def cache_size() -> int:
    """Number of cached resolutions (test/observability helper)."""
    return len(_cache)
