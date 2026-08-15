from __future__ import annotations

from typing import Any

RELEASE_MAX_LENGTH = 200

_CONTROL_CHARS = ("\n", "\t", "\r")


def normalize_release(value: Any) -> str | None:
    """Trim; drop empty; reject newlines/tabs/CR; cap at 200 chars.

    Invalid input is unreleased (``None``). Does not guess a git SHA.
    """
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > RELEASE_MAX_LENGTH:
        return None
    if any(char in trimmed for char in _CONTROL_CHARS):
        return None
    return trimmed
