from __future__ import annotations

import os

_debug_mode_enabled = False


def _is_env_flag_enabled(name: str) -> bool:
    """Accepts ``"1"`` (preferred) and ``"true"`` (backwards compatible). Case-sensitive."""
    value = os.environ.get(name)
    return value == "1" or value == "true"


def enable_debug_mode() -> None:
    global _debug_mode_enabled
    _debug_mode_enabled = True


def disable_debug_mode() -> None:
    global _debug_mode_enabled
    _debug_mode_enabled = False


def is_debug_mode_enabled() -> bool:
    return _debug_mode_enabled or _is_env_flag_enabled("LEMMA_DEBUG")


def is_debug_verify_enabled() -> bool:
    return _is_env_flag_enabled("LEMMA_DEBUG_VERIFY")


def _lemma_debug(prefix: str, msg: str, **data: object) -> None:
    if not is_debug_mode_enabled():
        return
    if data:
        print(f"[LEMMA:{prefix}] {msg}", data)
    else:
        print(f"[LEMMA:{prefix}] {msg}")
