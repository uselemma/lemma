"""Helpers for framework tool results that encode failure in the payload."""

from __future__ import annotations

import json
from typing import Any


def tool_result_error(output: Any) -> str | None:
    """Return an error message for MCP/Mastra-style tool failure payloads.

    Detects ``{isError: true}``, ``{is_error: true}``, and Mastra
    ``{error: true, message}`` results. Failures must be recorded as ``error``
    (with no ``output``) per the trace contract. Returns ``None`` when
    ``output`` is a normal success payload.
    """
    record = _as_result_record(output)
    if record is None:
        return None
    if (
        record.get("isError") is not True
        and record.get("is_error") is not True
        and record.get("error") is not True
    ):
        return None

    content = record.get("content")
    if isinstance(content, list):
        texts = [
            part.get("text")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ]
        text = "\n".join(text for text in texts if text).strip()
        if text:
            return text

    error = record.get("error")
    if isinstance(error, str) and error.strip():
        return error
    message = record.get("message")
    if isinstance(message, str) and message.strip():
        return message

    try:
        return json.dumps(record, default=str)
    except TypeError:
        return "Tool returned an error result"


def _as_result_record(output: Any) -> dict[str, Any] | None:
    if isinstance(output, dict):
        return output
    if not isinstance(output, str):
        return None
    trimmed = output.strip()
    if not trimmed.startswith("{") and not trimmed.startswith("["):
        return None
    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
