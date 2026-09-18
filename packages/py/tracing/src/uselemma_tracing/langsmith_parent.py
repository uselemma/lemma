"""Resolve LangSmith-only parents that never emit LangChain callbacks.

``langsmith.traceable`` wraps LangChain 1.x middleware hooks and creates
run-tree nodes without ``on_chain_start``. Nested callback runs then arrive
with that ghost as ``parent_run_id``. ``dotted_order`` lists the full
ancestry so we can alias the ghost to the nearest run the callback stream
actually delivered.
"""

from __future__ import annotations

import re
from collections.abc import Container
from typing import Any

# LangSmith dotted_order segments are "<timestamp>Z<uuid>", root first.
# Documented against langsmith.run_trees.RunTree.dotted_order.
_DOTTED_ORDER_UUID = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$",
    re.IGNORECASE,
)

try:
    from langsmith.run_helpers import get_tracing_context as _get_tracing_context
except ImportError:  # pragma: no cover - langsmith is optional
    _get_tracing_context = None


def ancestor_ids_from_dotted_order(dotted_order: str) -> list[str]:
    """Nearest-first ancestor UUIDs, excluding the current run-tree node."""
    if not dotted_order:
        return []
    ids: list[str] = []
    for segment in reversed(dotted_order.split(".")[:-1]):
        match = _DOTTED_ORDER_UUID.search(segment)
        if match:
            ids.append(match.group(1))
    return ids


def _active_run_tree() -> Any | None:
    if _get_tracing_context is None:
        return None
    ctx = _get_tracing_context()
    if not isinstance(ctx, dict):
        return None
    return ctx.get("parent")


def resolve_traceable_ghost(
    parent_run_id: Any,
    known_ids: Container[str],
) -> str | None:
    """Return the nearest callback-visible ancestor id for a LangSmith ghost.

    Only adopts when ``parent_run_id`` is the active run-tree node. Unknown
    parents that are not that node stay unresolved so they still become their
    own roots.
    """
    if parent_run_id is None:
        return None
    pid = str(parent_run_id)
    if pid in known_ids:
        return pid
    run_tree = _active_run_tree()
    if run_tree is None or str(getattr(run_tree, "id", "")) != pid:
        return None
    dotted_order = getattr(run_tree, "dotted_order", None)
    if not isinstance(dotted_order, str) or not dotted_order:
        return None
    for ancestor_id in ancestor_ids_from_dotted_order(dotted_order):
        if ancestor_id in known_ids:
            return ancestor_id
    return None
