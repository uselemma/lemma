from __future__ import annotations

import logging
import threading
from time import monotonic

from .debug_mode import is_debug_mode_enabled

# Window for repeat dropped-trace warnings. The first drop warns with its trace
# ID; drops inside the window are counted, and the next drop after it warns with
# that count. Keeps host-app logs readable and bounded during an outage or a
# bad key, while the first drop stays visible.
DROPPED_TRACE_WARNING_WINDOW_SECONDS = 60.0

logger = logging.getLogger(__name__)

# Process-wide, so several clients in one app share one budget of lines.
_lock = threading.Lock()
_last_warned_at: float | None = None
_suppressed = 0


def report_dropped_trace(trace_id: str, cause: str) -> None:
    """Warn about a trace that automatic delivery gave up on.

    ``cause`` completes "dropped trace <id> ...", for example
    "after 3 attempts: ingest returned 503". Debug mode logs every drop.
    """
    global _last_warned_at, _suppressed
    line = f"uselemma-tracing: dropped trace {trace_id} {cause}."
    if is_debug_mode_enabled():
        logger.warning(line)
        return
    with _lock:
        now = monotonic()
        if (
            _last_warned_at is not None
            and now - _last_warned_at < DROPPED_TRACE_WARNING_WINDOW_SECONDS
        ):
            _suppressed += 1
            return
        suppressed = _suppressed
        _last_warned_at = now
        _suppressed = 0
    since = f" {suppressed} more dropped since the last warning." if suppressed else ""
    logger.warning(
        f"{line}{since} Drops in the next "
        f"{int(DROPPED_TRACE_WARNING_WINDOW_SECONDS)}s are counted, not logged; "
        "set LEMMA_DEBUG=1 to log each one."
    )


def reset_dropped_trace_warnings() -> None:
    """Forget earlier drops; used by tests that share one process."""
    global _last_warned_at, _suppressed
    with _lock:
        _last_warned_at = None
        _suppressed = 0
