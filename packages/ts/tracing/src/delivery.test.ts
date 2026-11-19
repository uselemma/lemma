import { describe, expect, it, vi } from "vitest";
import { withFakeTimers } from "../test-helpers";
import {
  deliver,
  INGEST_MAX_ATTEMPTS,
  INGEST_REQUEST_TIMEOUT_MS,
  INGEST_RETRY_BASE_DELAY_MS,
  INGEST_RETRY_MAX_DELAY_MS,
  ingestFailureHint,
  ingestRetryDelayMs,
  isRetryableIngestStatus,
  parseRetryAfterMs,
} from "./delivery";

const LOG = { traceId: "trace-1", projectId: "project-1" };

function respond(status: number, body = "", headers?: Record<string, string>) {
  return vi.fn(async () => new Response(body || null, { status, headers }));
}

describe("delivery", () => {
  it("maps ingest failure status codes to hints", () => {
    expect(ingestFailureHint(401)).toContain("LEMMA_API_KEY");
    expect(ingestFailureHint(403)).toContain("project_id");
    expect(ingestFailureHint(429)).toContain("rate limit");
    expect(ingestFailureHint(404)).toContain("baseUrl");
    expect(ingestFailureHint(503)).toBeUndefined();
  });

  it("retries timeouts, rate limits and server errors only", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableIngestStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryableIngestStatus(status)).toBe(false);
    }
  });

  it("parses only a delta-seconds Retry-After", () => {
    expect(parseRetryAfterMs("1")).toBe(1_000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(parseRetryAfterMs(" ")).toBeNull();
    expect(parseRetryAfterMs("-1")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("doubles the jittered retry delay", () => {
    const base = INGEST_RETRY_BASE_DELAY_MS;
    expect(ingestRetryDelayMs(1, null, () => 0)).toBe(base / 2);
    expect(ingestRetryDelayMs(1, null, () => 1)).toBe(base);
    expect(ingestRetryDelayMs(2, null, () => 0)).toBe(base);
    expect(ingestRetryDelayMs(2, null, () => 1)).toBe(base * 2);
  });

  it("honors a Retry-After up to the cap", () => {
    expect(ingestRetryDelayMs(1, 1_000, () => 0)).toBe(1_000);
    expect(ingestRetryDelayMs(1, 0, () => 1)).toBe(INGEST_RETRY_BASE_DELAY_MS);
    expect(ingestRetryDelayMs(1, 60_000, () => 0)).toBe(
      INGEST_RETRY_MAX_DELAY_MS,
    );
  });

  it("returns the response of a delivered trace", async () => {
    const post = respond(201, "{}");
    const result = await deliver(post, LOG, INGEST_MAX_ATTEMPTS);
    expect(result.ok && result.response.status).toBe(201);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx up to the last attempt and names the cause", async () => {
    const post = respond(503, "busy");
    const result = await withFakeTimers(() =>
      deliver(post, LOG, INGEST_MAX_ATTEMPTS),
    );
    expect(post).toHaveBeenCalledTimes(INGEST_MAX_ATTEMPTS);
    expect(result).toMatchObject({
      ok: false,
      cause: `after ${INGEST_MAX_ATTEMPTS} attempts: ingest returned 503`,
    });
    expect(result.ok ? null : String(result.error)).toBe(
      "Error: @uselemma/tracing: failed to ingest trace (503): busy",
    );
  });

  it("does not retry a rejected request, and names the fix", async () => {
    const post = respond(401, "bad key");
    const result = await deliver(post, LOG, INGEST_MAX_ATTEMPTS);
    expect(post).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      cause: "after 1 attempt: ingest returned 401 (check LEMMA_API_KEY)",
    });
  });

  it("retries a network error", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(null, { status: 201 }));
    const result = await withFakeTimers(() =>
      deliver(post, LOG, INGEST_MAX_ATTEMPTS),
    );
    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("waits out a parsed Retry-After before the next attempt", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValue(new Response(null, { status: 201 }));

    vi.useFakeTimers();
    const pending = deliver(post, LOG, INGEST_MAX_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(999);
    expect(post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("times out a stalled request and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const result = await withFakeTimers(() =>
      deliver(
        (received) => {
          signal = received;
          return new Promise<Response>(() => {});
        },
        LOG,
        1,
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      cause: `after 1 attempt: TimeoutError: ingest request timed out after ${INGEST_REQUEST_TIMEOUT_MS}ms`,
    });
    expect(signal?.aborted).toBe(true);
  });

  it("sends once when one attempt is allowed", async () => {
    const post = respond(503, "busy");
    await deliver(post, LOG, 1);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
