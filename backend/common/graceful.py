"""common/graceful.py — uniform fallback + traceback-logging helper for
endpoints that drive key user-facing screens.

Batch #7 (May 2026) adds this module so an unhandled aggregation / third-party
failure in a secondary data source NEVER shows up as a raw 500 on a
production screen. Instead, the endpoint returns a structured empty shape
that the frontend already knows how to render (empty rails, skeletons, etc.)
while the real stack trace is captured in the backend log for triage.

Two public entry points:

1) `@graceful(fallback=..., label="...")` — decorator wrapping a FastAPI
   handler. FastAPI-safe because we preserve the wrapped function's
   signature via `functools.wraps`, so dependency injection still works.
   HTTPException is re-raised (401/403/404/422 must still propagate).

2) `await safe_shape(builder, fallback=..., logger=..., label="...")` —
   callable-style helper for ad-hoc use inside a handler body when you
   want to salvage just one sub-aggregation.

Usage (decorator form):

    from common.graceful import graceful

    @router.get("/foo")
    @graceful(fallback={"items": []}, label="foo")
    async def foo(...):
        ...expensive aggregation...
        return {"items": items}

The `fallback` MUST be shape-compatible with the frontend's success-path
expectations so the UI can render it without additional branching.
`fallback` can be a dict or a zero-arg callable that returns a dict
(useful when you want to inject a timestamp into the fallback).
"""
from __future__ import annotations

import functools
import logging
import traceback
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException

_default_logger = logging.getLogger("lumascout.graceful")


def graceful(
    *,
    fallback: Any,
    label: Optional[str] = None,
    logger: Optional[logging.Logger] = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    """Decorator: wrap a FastAPI handler. On unhandled Exception, log
    traceback and return `fallback`. HTTPException is re-raised unchanged
    so auth/permission/validation errors still surface normally.
    """
    log = logger or _default_logger

    def decorator(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        tag = label or fn.__name__

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await fn(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001 — intentional catch-all
                log.error(
                    "[%s] fell back due to unhandled exception: %s\n%s",
                    tag,
                    exc,
                    traceback.format_exc(),
                )
                return fallback() if callable(fallback) else fallback

        return wrapper

    return decorator


async def safe_shape(
    build: Callable[[], Awaitable[Any]],
    *,
    fallback: Any,
    logger: Optional[logging.Logger] = None,
    label: str = "endpoint",
) -> Any:
    """Callable-form helper. Run `build()` and return its result. On ANY
    exception, log the full traceback and return `fallback` instead of
    propagating. Never hides the real error from the server log — only
    from the client.
    """
    try:
        return await build()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — intentional catch-all
        log = logger or _default_logger
        log.error(
            "[%s] fell back due to unhandled exception: %s\n%s",
            label,
            exc,
            traceback.format_exc(),
        )
        return fallback() if callable(fallback) else fallback
