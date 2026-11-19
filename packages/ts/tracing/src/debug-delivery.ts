export const PRODUCTION_BASE_URL = "https://api.uselemma.ai";
export const INGEST_PATH = "/traces/ingest";
export const INGEST_STATUS_PATH = "/traces/ingest-status";
export const EXPECTED_INGEST_SUCCESS_STATUS = 201;

/** Poll interval for LEMMA_DEBUG_VERIFY ingest-status checks. */
export const INGEST_STATUS_POLL_INTERVAL_MS = 1_000;
/** Total wait budget for LEMMA_DEBUG_VERIFY ingest-status checks. */
export const INGEST_STATUS_POLL_TIMEOUT_MS = 15_000;

/**
 * Sends per automatic delivery: one plus two retries. That rides out a dropped
 * connection or an ingest worker restart without holding the caller's request
 * for long while Lemma is down.
 */
export const INGEST_MAX_ATTEMPTS = 3;
/**
 * Per-send timeout, the OTLP exporter default. Ingest answers once the payload
 * is stored and enqueued, so a healthy send finishes well inside it; without
 * one, a stalled connection blocks the caller indefinitely.
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

export type IngestStatus = "enqueued" | "ingested" | "ready" | "not_found";

const SUCCESS_INGEST_STATUSES = new Set<IngestStatus>([
  "enqueued",
  "ingested",
  "ready",
]);

export function isSuccessfulIngestStatus(
  status: IngestStatus | null | undefined,
): status is Exclude<IngestStatus, "not_found"> {
  return status != null && SUCCESS_INGEST_STATUSES.has(status);
}

export function parseIngestStatus(value: unknown): IngestStatus | null {
  if (
    value === "enqueued" ||
    value === "ingested" ||
    value === "ready" ||
    value === "not_found"
  ) {
    return value;
  }
  return null;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProjectId(projectId: string): boolean {
  return UUID_REGEX.test(projectId);
}

export function apiKeySuffix(apiKey: string): string {
  if (apiKey.length <= 4) return apiKey;
  return `...${apiKey.slice(-4)}`;
}

export function buildConfigWarnings(
  baseUrl: string,
  projectId: string,
): string[] {
  const warnings: string[] = [];
  if (baseUrl !== PRODUCTION_BASE_URL) {
    warnings.push(`baseUrl is not production (${PRODUCTION_BASE_URL})`);
  }
  if (!isValidProjectId(projectId)) {
    warnings.push("projectId is not a valid UUID");
  }
  return warnings;
}

export function ingestFailureHint(status: number): string | undefined {
  switch (status) {
    case 401:
      return "check LEMMA_API_KEY";
    case 403:
      return "API key doesn't own this project_id";
    case 429:
      return "ingest rate limit exceeded; lower the trace rate if it persists";
    case 404:
      return "baseUrl likely wrong (not Lemma API)";
    default:
      return undefined;
  }
}

export function pickResponseHeaders(
  headers: Headers,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of ["cf-ray", "server", "date"]) {
    const value = headers.get(name);
    if (value) picked[name] = value;
  }
  return picked;
}

export function pickResponseHeadersFromRecord(
  headers: Record<string, string>,
): Record<string, string> {
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const picked: Record<string, string> = {};
  for (const name of ["cf-ray", "server", "date"]) {
    const value = lowered[name];
    if (value) picked[name] = value;
  }
  return picked;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
