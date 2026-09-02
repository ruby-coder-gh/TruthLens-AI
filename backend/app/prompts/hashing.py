"""Content hashing for prompt revisions.

Lives in its own module (with no application imports) so both
`app.generation.generator` and `app.prompts.registry` can use it without an
import cycle — the registry reads `DEFAULT_SYSTEM_PROMPT` from the generator.
"""

from __future__ import annotations

import hashlib

# Mirrors the `_golden_set_version()` idiom: a short, human-quotable digest
# that fits `prompt_versions.content_hash` / `queries.prompt_version`
# (both String(16)).
HASH_LENGTH = 12


def compute_hash(content: str) -> str:
    """Return the short content hash identifying a prompt revision."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:HASH_LENGTH]
