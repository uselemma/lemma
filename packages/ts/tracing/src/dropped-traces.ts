import { DROPPED_TRACE_WARNING_WINDOW_MS } from "./debug-delivery";
import { isDebugModeEnabled } from "./debug-mode";

const PREFIX = "@uselemma/tracing:";
const WINDOW_SECONDS = DROPPED_TRACE_WARNING_WINDOW_MS / 1_000;

export type DroppedTrace = {
  traceId: string;
  /** Sends made before giving up; 0 when the payload could not be built. */
  attempts: number;
  reason: string;
};

type WarningState = {
  /** When the last warning was written; null until the first drop. */
  lastWarnedAt: number | null;
  pending: number;
  latestReason: string;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function initialState(): WarningState {
  return {
    lastWarnedAt: null,
    pending: 0,
    latestReason: "",
    timer: undefined,
  };
}

// Process-wide, so several clients in one app share one budget of lines.
let state = initialState();
let exitFlushInstalled = false;

/**
 * Report a partial window when the process exits. Integration `flush()` and
 * `shutdown()` run per request in serverless handlers, so flushing there would
 * print one line per request during an outage.
 */
function installExitFlush(): void {
  if (exitFlushInstalled) return;
  exitFlushInstalled = true;
  // Edge runtimes have no process events.
  if (typeof process === "undefined" || typeof process.once !== "function") {
    return;
  }
  process.once("exit", flushDroppedTraceWarnings);
}

function droppedTraceLine(trace: DroppedTrace): string {
  const attempts =
    trace.attempts > 0
      ? ` after ${trace.attempts} attempt${trace.attempts === 1 ? "" : "s"}`
      : "";
  return `${PREFIX} dropped trace ${trace.traceId}${attempts}: ${trace.reason}.`;
}

/**
 * Warn about a trace that automatic delivery gave up on. The first drop after
 * a quiet window warns with its trace ID; later drops in the window are
 * counted into one line at the window's end. Debug mode logs every drop.
 */
export function reportDroppedTrace(trace: DroppedTrace): void {
  if (isDebugModeEnabled()) {
    console.warn(droppedTraceLine(trace));
    return;
  }
  const now = Date.now();
  const windowOpen =
    state.lastWarnedAt !== null &&
    now - state.lastWarnedAt < DROPPED_TRACE_WARNING_WINDOW_MS;
  if (!windowOpen && state.pending === 0) {
    console.warn(
      `${droppedTraceLine(trace)} Further drops are counted and reported every ${WINDOW_SECONDS}s; set LEMMA_DEBUG=1 to log each one.`,
    );
    state.lastWarnedAt = now;
    return;
  }
  state.pending += 1;
  state.latestReason = trace.reason;
  installExitFlush();
  // The window can expire with drops pending before its timer runs, for
  // example while a serverless instance was frozen; report them now.
  if (!windowOpen) {
    flushDroppedTraceWarnings();
    return;
  }
  if (state.timer === undefined) {
    state.timer = setTimeout(
      flushDroppedTraceWarnings,
      (state.lastWarnedAt as number) + DROPPED_TRACE_WARNING_WINDOW_MS - now,
    );
    // Must not keep a finished script alive for the rest of the window.
    (state.timer as { unref?: () => void }).unref?.();
  }
}

/** Write the count of drops not reported yet, and start a new window. */
export function flushDroppedTraceWarnings(): void {
  clearTimeout(state.timer);
  state.timer = undefined;
  if (state.pending === 0) return;
  const now = Date.now();
  const seconds = Math.max(
    1,
    Math.round((now - (state.lastWarnedAt ?? now)) / 1_000),
  );
  console.warn(
    `${PREFIX} dropped ${state.pending} more trace${state.pending === 1 ? "" : "s"} in the last ${seconds}s; latest: ${state.latestReason}. Set LEMMA_DEBUG=1 to log each one.`,
  );
  state.pending = 0;
  state.lastWarnedAt = now;
}

/** Forget earlier drops; used by tests that share one process. */
export function resetDroppedTraceWarnings(): void {
  clearTimeout(state.timer);
  state = initialState();
  if (
    exitFlushInstalled &&
    typeof process !== "undefined" &&
    typeof process.removeListener === "function"
  ) {
    process.removeListener("exit", flushDroppedTraceWarnings);
  }
  exitFlushInstalled = false;
}
