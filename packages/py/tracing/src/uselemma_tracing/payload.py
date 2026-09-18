"""Shape an ingest payload before it is serialized.

Integrators redact or drop with ``before_send``. Optional SDK shaping can
deduplicate identical child inputs and cap oversized content. Structural
keys (ids, timings, names, roles) are never replaced.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Iterable

BeforeSend = Callable[[dict[str, Any]], dict[str, Any] | None]

# Identity, timing, and classification. Redactors must keep these so Lemma
# can still assemble the tree, attribute a model call, and show roles.
STRUCTURAL_PAYLOAD_KEYS: frozenset[str] = frozenset(
    {
        "project_id",
        "id",
        "parent_id",
        "name",
        "type",
        "status",
        "started_at",
        "ended_at",
        "duration_ms",
        "model",
        "tool_name",
        "thread_id",
        "user_id",
        "release",
        "role",
    }
)

TRUNCATION_MARKER_KEY = "__lemma_truncated__"
DEDUP_MARKER_KEY = "__lemma_deduplicated__"
TRUNCATION_PREVIEW_CHARS = 256

_CONTENT_KEYS = frozenset({"input", "output", "error"})
_NESTED_CONTENT_MAPS = frozenset({"metadata", "attributes"})


def dumps_payload(value: Any) -> str:
    """Serialize the way ``Lemma._send`` does, so size checks match the POST."""
    return json.dumps(value, default=str)


def encoded_size(value: Any) -> int:
    return len(dumps_payload(value).encode())


def truncation_marker(value: Any, *, kind: str = "payload_cap") -> dict[str, Any]:
    marker: dict[str, Any] = {
        TRUNCATION_MARKER_KEY: True,
        "kind": kind,
        "original_bytes": encoded_size(value),
    }
    if isinstance(value, str):
        preview = value[:TRUNCATION_PREVIEW_CHARS]
        if len(value) > TRUNCATION_PREVIEW_CHARS:
            preview = f"{preview}…"
        marker["preview"] = preview
    elif isinstance(value, list):
        marker["item_count"] = len(value)
    elif isinstance(value, dict):
        marker["key_count"] = len(value)
    return marker


def dedup_marker(parent_id: str) -> dict[str, Any]:
    return {
        DEDUP_MARKER_KEY: True,
        "identical_to": "parent.input",
        "parent_id": parent_id,
    }


def _canonical(value: Any) -> str:
    try:
        return json.dumps(value, default=str, separators=(",", ":"), sort_keys=True)
    except TypeError:
        return dumps_payload(value)


def apply_span_content_dedup(payload: dict[str, Any]) -> dict[str, Any]:
    """Replace a span input that is byte-identical to its parent's input."""
    trace = payload.get("trace")
    if not isinstance(trace, dict):
        return payload
    spans = trace.get("spans")
    if not isinstance(spans, list):
        return payload

    original_inputs: dict[str, Any] = {}
    for span in spans:
        if isinstance(span, dict) and isinstance(span.get("id"), str):
            original_inputs[span["id"]] = span.get("input")

    for span in spans:
        if not isinstance(span, dict):
            continue
        parent_id = span.get("parent_id")
        if not isinstance(parent_id, str) or parent_id not in original_inputs:
            continue
        child_input = span.get("input")
        parent_input = original_inputs[parent_id]
        if child_input is None or parent_input is None:
            continue
        if _canonical(child_input) != _canonical(parent_input):
            continue
        span["input"] = dedup_marker(parent_id)
    return payload


def _iter_content_fields(
    payload: dict[str, Any],
) -> Iterable[tuple[dict[str, Any], str, Any]]:
    """Yield ``(container, key, value)`` for fields that may be truncated."""
    trace = payload.get("trace")
    if not isinstance(trace, dict):
        return
    yield from _iter_record_content(trace)
    spans = trace.get("spans")
    if not isinstance(spans, list):
        return
    for span in spans:
        if isinstance(span, dict):
            yield from _iter_record_content(span)


def _iter_record_content(
    record: dict[str, Any],
) -> Iterable[tuple[dict[str, Any], str, Any]]:
    for key in _CONTENT_KEYS:
        if key in record and record[key] is not None:
            yield record, key, record[key]
    for map_key in _NESTED_CONTENT_MAPS:
        nested = record.get(map_key)
        if not isinstance(nested, dict):
            continue
        for nested_key, nested_value in nested.items():
            if nested_key in STRUCTURAL_PAYLOAD_KEYS:
                continue
            if nested_value is None:
                continue
            yield nested, nested_key, nested_value


def apply_payload_cap(payload: dict[str, Any], max_bytes: int) -> dict[str, Any]:
    """Replace largest content fields with truncation markers until under cap.

    Structural keys are never replaced. If the structural envelope alone
    exceeds ``max_bytes``, the payload is returned with content truncated
    and may still serialize above the cap.

    Size is tracked with a running byte ledger: each field and marker is
    serialized once, then the payload total is updated by the delta so a
    megabyte-scale trace is not re-encoded on every replacement.
    """
    if max_bytes <= 0:
        raise ValueError("uselemma-tracing: max_payload_bytes must be > 0")
    current = encoded_size(payload)
    if current <= max_bytes:
        return payload

    sized = [
        (container, key, value, encoded_size(value))
        for container, key, value in _iter_content_fields(payload)
    ]
    sized.sort(key=lambda item: item[3], reverse=True)
    for container, key, value, value_bytes in sized:
        if current <= max_bytes:
            break
        marker = truncation_marker(value)
        marker_bytes = encoded_size(marker)
        if value_bytes <= marker_bytes:
            continue
        container[key] = marker
        current += marker_bytes - value_bytes
    return payload


def apply_before_send(
    payload: dict[str, Any],
    before_send: BeforeSend,
) -> dict[str, Any] | None:
    result = before_send(payload)
    if result is None:
        return None
    if not isinstance(result, dict):
        raise TypeError(
            "uselemma-tracing: before_send must return a payload dict or None"
        )
    return result
