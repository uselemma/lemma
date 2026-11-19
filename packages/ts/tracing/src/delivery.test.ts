import { describe, expect, it, vi } from "vitest";
import { withFakeTimers } from "../test-helpers";
import {
  INGEST_MAX_ATTEMPTS,
  INGEST_REQUEST_TIMEOUT_MS,
  INGEST_RETRY_BASE_DELAY_MS,
  INGEST_RETRY_MAX_DELAY_MS,
  ingestRetryDelayMs,
  isRetryableIngestStatus,
  sendOnce,
  sendWithRetries,
} from "./delivery";

const LOG = { traceId: "trace-1", projectId: "project-1" };

describe("delivery", () => {
  it("retries timeouts, rate limits and server errors only", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableIngestStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryableIngestStatus(status)).toBe(false);
    }
  });

  it("doubles the jittered retry delay", () => {
    const base = INGEST_RETRY_BASE_DELAY_MS;
    expect(ingestRetryDelayMs(1, null, () => 0)).toBe(base / 2);
    expect(ingestRetryDelayMs(1, null, () => 1)).toBe(base);
    expect(ingestRetryDelayMs(2, null, () => 0)).toBe(base);
    expect(ingestRetryDelayMs(2, null, () => 1)).toBe(base * 2);
  });

  it("honors a delta-seconds Retry-After up to the cap", () => {
    expect(ingestRetryDelayMs(1, "1", () => 0)).toBe(1_000);
    expect(ingestRetryDelayMs(1, "0", () => 1)).toBe(
      INGEST_RETRY_BASE_DELAY_MS,
    );
    expect(ingestRetryDelayMs(1, "60", () => 0)).toBe(
      INGEST_RETRY_MAX_DELAY_MS,
    );
    expect(
      ingestRetryDelayMs(1, "Wed, 21 Oct 2026 07:28:00 GMT", () => 0),
    ).toBe(INGEST_RETRY_BASE_DELAY_MS / 2);
    expect(ingestRetryDelayMs(1, " ", () => 0)).toBe(
      INGEST_RETRY_BASE_DELAY_MS / 2,
    );
  });

  it("classifies a 2xx as delivered", async () => {
    const response = new Response(null, { status: 201 });
    await expect(sendOnce(async () => response, LOG)).resolves.toEqual({
      ok: true,
      response,
    });
  });

  it("classifies a 5xx as retryable and keeps its Retry-After", async () => {
    const attempt = await sendOnce(
      async () =>
        new Response("busy", {
          status: 503,
          headers: { "retry-after": "1" },
        }),
      LOG,
    );
    expect(attempt).toMatchObject({
      ok: false,
      reason: "ingest returned 503",
      retryable: true,
      retryAfter: "1",
    });
    expect(attempt.ok ? null : String(attempt.error)).toBe(
      "Error: @uselemma/tracing: failed to ingest trace (503): busy",
    );
  });

  it("classifies a rejected request as final, with its hint", async () => {
    await expect(
      sendOnce(async () => new Response("bad key", { status: 401 }), LOG),
    ).resolves.toMatchObject({
      ok: false,
      reason: "ingest returned 401 (check LEMMA_API_KEY)",
      retryable: false,
      retryAfter: null,
    });
  });

  it("classifies a network error as retryable", async () => {
    await expect(
      sendOnce(async () => {
        throw new TypeError("fetch failed");
      }, LOG),
    ).resolves.toMatchObject({
      ok: false,
      reason: "TypeError: fetch failed",
      retryable: true,
    });
  });

  it("times out a stalled request and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const attempt = await withFakeTimers(() =>
      sendOnce((received) => {
        signal = received;
        return new Promise<Response>(() => {});
      }, LOG),
    );
    expect(attempt).toMatchObject({
      ok: false,
      reason: `TimeoutError: ingest request timed out after ${INGEST_REQUEST_TIMEOUT_MS}ms`,
      retryable: true,
    });
    expect(signal?.aborted).toBe(true);
  });

  it("stops after the last attempt and reports how many were made", async () => {
    const post = vi.fn(async () => new Response("busy", { status: 503 }));
    const { attempt, attempts } = await withFakeTimers(() =>
      sendWithRetries(post, LOG, INGEST_MAX_ATTEMPTS),
    );
    expect(attempt.ok).toBe(false);
    expect(attempts).toBe(INGEST_MAX_ATTEMPTS);
    expect(post).toHaveBeenCalledTimes(INGEST_MAX_ATTEMPTS);
  });

  it("stops at the first final failure", async () => {
    const post = vi.fn(async () => new Response("bad key", { status: 401 }));
    const { attempts } = await sendWithRetries(post, LOG, INGEST_MAX_ATTEMPTS);
    expect(attempts).toBe(1);
  });

  it("sends once when one attempt is allowed", async () => {
    const post = vi.fn(async () => new Response("busy", { status: 503 }));
    const { attempts } = await sendWithRetries(post, LOG, 1);
    expect(attempts).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
