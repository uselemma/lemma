import { isDebugModeEnabled } from "./debug-mode";

/**
 * Window for repeat dropped-trace warnings. The first drop warns with its
 * trace ID; drops inside the window are counted, and the next drop after it
 * warns with that count. Keeps host-app logs readable and bounded during an
 * outage or a bad key, while the first drop stays visible.
 */
export const DROPPED_TRACE_WARNING_WINDOW_MS = 60_000;

const PREFIX = "@uselemma/tracing:";
const WINDOW_SECONDS = DROPPED_TRACE_WARNING_WINDOW_MS / 1_000;

// Process-wide, so several clients in one app share one budget of lines.
let lastWarnedAt: number | null = null;
let suppressed = 0;

/**
 * Warn about a trace that automatic delivery gave up on. `cause` completes
 * "dropped trace <id> …", for example "after 3 attempts: ingest returned 503".
 * Debug mode logs every drop.
 */
export function reportDroppedTrace(traceId: string, cause: string): void {
  const line = `${PREFIX} dropped trace ${traceId} ${cause}.`;
  if (isDebugModeEnabled()) {
    console.warn(line);
    return;
  }
  const now = Date.now();
  if (
    lastWarnedAt !== null &&
    now - lastWarnedAt < DROPPED_TRACE_WARNING_WINDOW_MS
  ) {
    suppressed += 1;
    return;
  }
  const since =
    suppressed > 0 ? ` ${suppressed} more dropped since the last warning.` : "";
  console.warn(
    `${line}${since} Drops in the next ${WINDOW_SECONDS}s are counted, not logged; set LEMMA_DEBUG=1 to log each one.`,
  );
  lastWarnedAt = now;
  suppressed = 0;
}

/** Forget earlier drops; used by tests that share one process. */
export function resetDroppedTraceWarnings(): void {
  lastWarnedAt = null;
  suppressed = 0;
}
