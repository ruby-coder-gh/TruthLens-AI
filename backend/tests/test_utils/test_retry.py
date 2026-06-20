"""Tests for retry utility."""

from __future__ import annotations

import pytest

from app.utils.retry import async_retry


class TestAsyncRetry:
    @pytest.mark.asyncio
    async def test_succeeds_first_attempt(self):
        call_count = 0

        @async_retry(attempts=3)
        async def func():
            nonlocal call_count
            call_count += 1
            return "success"

        result = await func()
        assert result == "success"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_retry_then_succeeds(self):
        call_count = 0

        @async_retry(attempts=3)
        async def func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("temporary")
            return "ok"

        result = await func()
        assert result == "ok"
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_raises_after_max_attempts(self):
        call_count = 0

        @async_retry(attempts=3)
        async def func():
            nonlocal call_count
            call_count += 1
            raise ValueError("always fails")

        with pytest.raises(ValueError, match="always fails"):
            await func()
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_custom_exception_types(self):
        call_count = 0

        @async_retry(attempts=3, exceptions=(ValueError,))
        async def func():
            nonlocal call_count
            call_count += 1
            raise TypeError("not retried")

        with pytest.raises(TypeError):
            await func()
        assert call_count == 1  # not retried — exception not in list

    @pytest.mark.asyncio
    async def test_passes_args_and_kwargs(self):
        @async_retry(attempts=2)
        async def func(a, b, c=0):
            return a + b + c

        result = await func(1, 2, c=3)
        assert result == 6
