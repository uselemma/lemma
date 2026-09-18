"""Span-filter policy and run registration for the LangChain handler.

Hook nodes can be dropped by name or predicate. A skipped run still occupies
the parent map so children nest under the nearest included ancestor. Ending a
skipped run is a no-op so callback stop paths never double-end a passthrough
handle.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from fnmatch import fnmatch
from typing import Any

from .client import SpanHandle


@dataclass
class StoredRun:
    owning_trace_id: str
    root_run_id: str
    kind: str
    started_at: datetime
    owns_trace: bool
    parent_run_id: str | None = None
    handle: SpanHandle | None = None
    # Owned LLM ended with tool_calls — keep stub so later tools/generations
    # can nest, and defer finalize until a final answer or flush.
    defer_finalize: bool = False
    # Filtered out: keep the run so children nest under the nearest included
    # ancestor, but never end() the passthrough handle.
    skipped: bool = False


def keep_span(
    name: str,
    exclude_span_names: tuple[str, ...],
    include_span: Callable[[str], bool] | None,
) -> bool:
    if any(
        name == pattern or fnmatch(name, pattern) for pattern in exclude_span_names
    ):
        return False
    if include_span is not None:
        return bool(include_span(name))
    return True


def store_run(
    runs: dict[str, StoredRun],
    run_id: str,
    *,
    name: str,
    kind: str,
    started_at: datetime,
    owning_trace_id: str,
    root_run_id: str,
    owns_trace: bool,
    parent_run_id: str | None,
    parent: StoredRun | None,
    start_handle: Callable[[], SpanHandle],
    exclude_span_names: tuple[str, ...],
    include_span: Callable[[str], bool] | None,
) -> StoredRun:
    skipped = not keep_span(name, exclude_span_names, include_span)
    handle: SpanHandle | None = None
    if skipped:
        if not owns_trace and parent is not None:
            handle = parent.handle
    else:
        handle = start_handle()
    run = StoredRun(
        owning_trace_id=owning_trace_id,
        root_run_id=root_run_id,
        kind=kind,
        started_at=started_at,
        owns_trace=owns_trace,
        parent_run_id=str(parent_run_id) if parent_run_id is not None else None,
        handle=handle,
        skipped=skipped,
    )
    runs[str(run_id)] = run
    return run


def end_run_handle(run: StoredRun, **kwargs: Any) -> None:
    """End a recorded span. No-op when the run was filtered or has no handle."""
    if run.skipped or run.handle is None:
        return
    run.handle.end(**kwargs)
