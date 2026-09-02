"""Versioned prompt registry.

Intentionally empty of re-exports: `app.prompts.registry` imports
`DEFAULT_SYSTEM_PROMPT` from `app.generation.generator`, which in turn imports
`app.prompts.hashing`. Eagerly pulling the registry in here would close that
cycle at import time. Import the submodules directly:

    from app.prompts.hashing import compute_hash
    from app.prompts.registry import get_active, invalidate
"""
