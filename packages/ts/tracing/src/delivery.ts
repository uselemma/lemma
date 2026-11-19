import {
  ingestFailureHint,
  pickResponseHeaders,
  sleep,
} from "./debug-delivery";
import { lemmaDebug } from "./debug-mode";
import { describeError, failureMessage } from "./error-message";

/**
 * Sends per automatic delivery: one plus two retries. That rides out a dropped
 * connection or an ingest worker restart without holding the caller's request
 * for long while Lemma is down.
 */
export const INGEST_MAX_ATTEMPTS = 3;
/**
 * Per-request timeout, the OTLP exporter default. Ingest answers once the
 * payload is stored and enqueued, so a healthy send finishes well inside it;
 * without one, a stalled connection blocks the caller indefinitely.
 */
export const INGEST_REQUEST_TIMEOUT_MS = 10_000;
/**
 * Delay before the first retry; each later retry doubles it. Jitter keeps
 * clients that failed together from retrying in lockstep.
 */
export const INGEST_RETRY_BASE_DELAY_MS = 500;
/**
 * Ceiling for one retry delay, a server `Retry-After` included, so a
 * rate-limited send cannot hold the caller's request for long.
 */
export const INGEST_RETRY_MAX_DELAY_MS = 2_000;

/**
 * Statuses where resending the same payload can succeed. A resend after a
 * success the client never saw is harmless: ingest skips stored span IDs.
 */
export function isRetryableIngestStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Delay before retry number `retry` (1-based). */
export function ingestRetryDelayMs(
  retry: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): number {
  const backoff = INGEST_RETRY_BASE_DELAY_MS * 2 ** (retry - 1);
  const jittered = backoff / 2 + random() * (backoff / 2);
  return Math.min(
    INGEST_RETRY_MAX_DELAY_MS,
    Math.max(jittered, retryAfterMs(retryAfter) ?? 0),
  );
}

/** Only the delta-seconds form; an HTTP-date falls back to backoff. */
function retryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

/**
 * Bound one ingest request, body read included. The race also covers a custom
 * `fetch` that ignores the abort signal.
 */
export async function withIngestTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `ingest request timed out after ${INGEST_REQUEST_TIMEOUT_MS}ms`,
      );
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, INGEST_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** One POST of a serialized payload; the client owns the URL and credentials. */
export type PostIngest = (signal: AbortSignal) => Promise<Response>;

/** Identifiers on every delivery debug line. */
export type DeliveryLogFields = { traceId?: string; projectId: string };

export type SendAttempt =
  | { ok: true; response: Response }
  | {
      ok: false;
      error: unknown;
      /** Completes "dropped trace <id> after N attempts: …". */
      reason: string;
      retryable: boolean;
      retryAfter: string | null;
    };

/** Send once under the request timeout and classify the outcome. */
export async function sendOnce(
  post: PostIngest,
  log: DeliveryLogFields,
): Promise<SendAttempt> {
  try {
    return await withIngestTimeout<SendAttempt>(async (signal) => {
      const response = await post(signal);
      if (response.ok) return { ok: true, response };

      const body = await response.text().catch(() => "");
      const hint = ingestFailureHint(response.status);
      lemmaDebug("client", "trace ingest failed", {
        ...log,
        status: response.status,
        body,
        ...pickResponseHeaders(response.headers),
        ...(hint ? { hint } : {}),
      });
      return {
        ok: false,
        error: new Error(
          `@uselemma/tracing: failed to ingest trace (${response.status})${body ? `: ${body}` : ""}`,
        ),
        reason: `ingest returned ${response.status}${hint ? ` (${hint})` : ""}`,
        retryable: isRetryableIngestStatus(response.status),
        retryAfter: response.headers.get("retry-after"),
      };
    });
  } catch (error) {
    lemmaDebug("client", "trace ingest failed", {
      ...log,
      error: failureMessage(error) ?? String(error),
    });
    return {
      ok: false,
      error,
      reason: describeError(error),
      retryable: true,
      retryAfter: null,
    };
  }
}

/**
 * Send up to `maxAttempts` times, backing off between retryable failures.
 * Returns the last attempt and how many were made.
 */
export async function sendWithRetries(
  post: PostIngest,
  log: DeliveryLogFields,
  maxAttempts: number,
): Promise<{ attempt: SendAttempt; attempts: number }> {
  for (let attempts = 1; ; attempts += 1) {
    const attempt = await sendOnce(post, log);
    if (attempt.ok || !attempt.retryable || attempts >= maxAttempts) {
      return { attempt, attempts };
    }
    const delayMs = ingestRetryDelayMs(attempts, attempt.retryAfter);
    lemmaDebug("client", "retrying trace ingest", {
      ...log,
      attempt: attempts,
      maxAttempts,
      delayMs,
    });
    await sleep(delayMs);
  }
}
