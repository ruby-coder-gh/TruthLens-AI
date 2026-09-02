"""Tests for the prompt registry (`app.prompts.registry`).

The registry resolves the *active* prompt for a logical name (e.g. ``answer``)
from the ``prompt_versions`` table, falling back to the code constant
``DEFAULT_SYSTEM_PROMPT`` so a fresh database behaves exactly as it did before
F1 landed (zero behaviour change).
"""

from __future__ import annotations

import pytest

from app.generation.generator import DEFAULT_SYSTEM_PROMPT
from app.models.prompt_version import PromptVersion
from app.prompts import registry


class TestComputeHash:
    def test_hash_is_twelve_hex_chars(self):
        digest = registry.compute_hash("hello")
        assert len(digest) == 12
        assert all(c in "0123456789abcdef" for c in digest)

    def test_hash_is_stable_and_content_sensitive(self):
        assert registry.compute_hash("abc") == registry.compute_hash("abc")
        assert registry.compute_hash("abc") != registry.compute_hash("abd")


class TestGetActive:
    async def test_falls_back_to_code_default_when_table_empty(self, test_db):
        resolved = await registry.get_active(test_db, "answer")

        assert resolved.content == DEFAULT_SYSTEM_PROMPT
        assert resolved.hash == registry.compute_hash(DEFAULT_SYSTEM_PROMPT)
        assert resolved.version_id is None
        assert resolved.model_name is None
        assert resolved.is_default is True

    async def test_returns_active_row_when_present(self, test_db):
        content = "You are a pinned, versioned assistant."
        row = PromptVersion(
            name="answer",
            version=1,
            content=content,
            content_hash=registry.compute_hash(content),
            status="active",
            model_name="llama3.2:3b",
        )
        test_db.add(row)
        await test_db.commit()

        resolved = await registry.get_active(test_db, "answer")

        assert resolved.content == content
        assert resolved.hash == registry.compute_hash(content)
        assert resolved.version_id == row.id
        assert resolved.model_name == "llama3.2:3b"
        assert resolved.is_default is False

    async def test_draft_rows_are_ignored(self, test_db):
        test_db.add(
            PromptVersion(
                name="answer",
                version=1,
                content="draft only",
                content_hash=registry.compute_hash("draft only"),
                status="draft",
            )
        )
        await test_db.commit()

        resolved = await registry.get_active(test_db, "answer")

        assert resolved.is_default is True
        assert resolved.content == DEFAULT_SYSTEM_PROMPT

    async def test_result_is_cached_until_invalidated(self, test_db):
        first = await registry.get_active(test_db, "answer")
        assert first.is_default is True

        content = "A newly promoted prompt."
        test_db.add(
            PromptVersion(
                name="answer",
                version=1,
                content=content,
                content_hash=registry.compute_hash(content),
                status="active",
            )
        )
        await test_db.commit()

        # Still the cached default — the registry does not re-query per call.
        assert (await registry.get_active(test_db, "answer")).is_default is True

        registry.invalidate("answer")

        refreshed = await registry.get_active(test_db, "answer")
        assert refreshed.is_default is False
        assert refreshed.content == content

    async def test_invalidate_without_name_clears_every_entry(self, test_db):
        await registry.get_active(test_db, "answer")
        await registry.get_active(test_db, "other")

        registry.invalidate()

        assert registry.cache_size() == 0

    async def test_unknown_name_falls_back_to_default_prompt(self, test_db):
        resolved = await registry.get_active(test_db, "not-a-real-prompt")
        assert resolved.is_default is True
        assert resolved.content == DEFAULT_SYSTEM_PROMPT

    async def test_database_error_degrades_to_the_default_prompt(self, test_db, monkeypatch):
        """A deployment that has not run migration 010 must still answer queries."""
        from sqlalchemy.exc import OperationalError

        async def _boom(*args, **kwargs):
            raise OperationalError("SELECT 1", {}, Exception("no such table: prompt_versions"))

        monkeypatch.setattr(test_db, "execute", _boom)

        resolved = await registry.get_active(test_db, "answer")

        assert resolved.is_default is True
        assert resolved.content == DEFAULT_SYSTEM_PROMPT

    async def test_database_error_is_not_cached(self, test_db, monkeypatch):
        """A transient read failure must not pin the default forever."""
        from sqlalchemy.exc import OperationalError

        async def _boom(*args, **kwargs):
            raise OperationalError("SELECT 1", {}, Exception("locked"))

        monkeypatch.setattr(test_db, "execute", _boom)
        await registry.get_active(test_db, "answer")

        assert registry.cache_size() == 0

        monkeypatch.undo()
        content = "Recovered prompt."
        test_db.add(
            PromptVersion(
                name="answer",
                version=1,
                content=content,
                content_hash=registry.compute_hash(content),
                status="active",
            )
        )
        await test_db.commit()

        assert (await registry.get_active(test_db, "answer")).content == content


class TestDefaultPromptHash:
    def test_module_constant_matches_computed_hash(self):
        assert registry.DEFAULT_PROMPT_HASH == registry.compute_hash(DEFAULT_SYSTEM_PROMPT)

    def test_hash_fits_the_column_width(self):
        # `prompt_versions.content_hash` / `queries.prompt_version` are String(16).
        assert len(registry.DEFAULT_PROMPT_HASH) <= 16


@pytest.mark.parametrize("status", ["draft", "staged", "retired"])
async def test_non_active_statuses_never_resolve(test_db, status):
    test_db.add(
        PromptVersion(
            name="answer",
            version=1,
            content=f"content for {status}",
            content_hash=registry.compute_hash(f"content for {status}"),
            status=status,
        )
    )
    await test_db.commit()

    resolved = await registry.get_active(test_db, "answer")
    assert resolved.is_default is True
