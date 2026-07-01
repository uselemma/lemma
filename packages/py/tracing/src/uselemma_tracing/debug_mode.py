from __future__ import annotations

import os

_debug_mode_enabled = False


def enable_debug_mode() -> None:
    global _debug_mode_enabled
    _debug_mode_enabled = True


def disable_debug_mode() -> None:
    global _debug_mode_enabled
    _debug_mode_enabled = False


def is_debug_mode_enabled() -> bool:
    return _debug_mode_enabled or os.environ.get("LEMMA_DEBUG") == "true"


def _lemma_debug(prefix: str, msg: str, **data: object) -> None:
    if not is_debug_mode_enabled():
        return
    if data:
        print(f"[LEMMA:{prefix}] {msg}", data)
    else:
        print(f"[LEMMA:{prefix}] {msg}")
