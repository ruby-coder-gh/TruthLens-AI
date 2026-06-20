"""Async retry decorator using tenacity."""

from __future__ import annotations

from typing import Any, Callable, TypeVar

from tenacity import (
    AsyncRetrying,
    before_sleep_log,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from tenacity.stop import stop_base
from tenacity.wait import wait_base

from app.utils.logger import logger

T = TypeVar("T")


def async_retry(
    attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 10.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    stop: stop_base | None = None,
    wait: wait_base | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator for async functions with retry logic.

    Args:
        attempts: Max retry attempts.
        min_wait: Minimum wait between retries (exponential backoff).
        max_wait: Maximum wait between retries.
        exceptions: Exception types to retry on.
    """
    from functools import wraps

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            retryer = AsyncRetrying(
                stop=stop or stop_after_attempt(attempts),
                wait=wait or wait_exponential(multiplier=min_wait, max=max_wait),
                retry=retry_if_exception_type(exceptions),
                before_sleep=before_sleep_log(logger, 20),  # WARNING level
                reraise=True,
            )
            async for attempt in retryer:
                with attempt:
                    return await func(*args, **kwargs)
            return None  # unreachable

        return wrapper

    return decorator
