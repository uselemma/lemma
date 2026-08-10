"""Normalization of thrown/reported failures into recordable messages."""

from __future__ import annotations

import json
from typing import Any

GENERIC_ERROR_NAME = "Error"

# Base classes whose name adds nothing to the message they already carry.
_GENERIC_ERROR_NAMES = frozenset({"Exception", "BaseException", GENERIC_ERROR_NAME})


def error_message(error: Any) -> str | None:
    """Return a human-readable message for ``error``.

    Returns ``None`` only when there is no failure at all — never an empty
    string. Callers derive ``status="ERROR"`` and root-trace failure from the
    presence of a message, so an empty one would silently downgrade a failed
    run to a successful one.
    """
    if error is None:
        return None
    if isinstance(error, BaseException):
        return _qualify(type(error).__name__, str(error))
    if isinstance(error, str):
        return error.strip() or None
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            name = error.get("name")
            return _qualify(name if isinstance(name, str) else None, message)
        return _stringify(error)
    return str(error).strip() or None


def describe_error(error: Any) -> str:
    """Same normalization for paths that already know the run failed.

    Falls back to a generic message rather than dropping the failure.
    """
    return error_message(error) or GENERIC_ERROR_NAME


def _qualify(name: str | None, message: str) -> str:
    """Keep the class name when it carries information.

    ``ValueError: bad input`` stays qualified, a bare ``Exception`` does not
    repeat itself.
    """
    clean_name = (name or "").strip()
    clean_message = message.strip()
    if not clean_message:
        return clean_name or GENERIC_ERROR_NAME
    if (
        not clean_name
        or clean_name in _GENERIC_ERROR_NAMES
        or clean_message.startswith(f"{clean_name}:")
    ):
        return clean_message
    return f"{clean_name}: {clean_message}"


def _stringify(error: dict[str, Any]) -> str:
    if not error:
        return GENERIC_ERROR_NAME
    try:
        text = json.dumps(error, default=str)
        if text and text != "{}":
            return text
    except (TypeError, ValueError):
        pass
    return str(error).strip() or GENERIC_ERROR_NAME
