import { describe, expect, it } from "vitest";
import {
  apiKeySuffix,
  buildConfigWarnings,
  INGEST_RETRY_BASE_DELAY_MS,
  INGEST_RETRY_MAX_DELAY_MS,
  ingestFailureHint,
  ingestRetryDelayMs,
  isRetryableIngestStatus,
  isValidProjectId,
  pickResponseHeadersFromRecord,
  PRODUCTION_BASE_URL,
} from "./debug-delivery";

describe("debug-delivery", () => {
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
    expect(ingestRetryDelayMs(1, "0", () => 1)).toBe(INGEST_RETRY_BASE_DELAY_MS);
    expect(ingestRetryDelayMs(1, "60", () => 0)).toBe(INGEST_RETRY_MAX_DELAY_MS);
    expect(
      ingestRetryDelayMs(1, "Wed, 21 Oct 2026 07:28:00 GMT", () => 0),
    ).toBe(INGEST_RETRY_BASE_DELAY_MS / 2);
    expect(ingestRetryDelayMs(1, " ", () => 0)).toBe(
      INGEST_RETRY_BASE_DELAY_MS / 2,
    );
  });

  it("validates project ids as UUIDs", () => {
    expect(isValidProjectId("10000000-0000-0000-0000-000000000001")).toBe(true);
    expect(isValidProjectId("not-a-uuid")).toBe(false);
  });

  it("masks api keys to the last four characters", () => {
    expect(apiKeySuffix("sk_live_abc12345")).toBe("...2345");
    expect(apiKeySuffix("key")).toBe("key");
  });

  it("warns on non-production baseUrl and invalid projectId", () => {
    expect(
      buildConfigWarnings("http://localhost:8000", "bad-id"),
    ).toEqual([
      `baseUrl is not production (${PRODUCTION_BASE_URL})`,
      "projectId is not a valid UUID",
    ]);
  });

  it("maps ingest failure status codes to hints", () => {
    expect(ingestFailureHint(401)).toContain("LEMMA_API_KEY");
    expect(ingestFailureHint(403)).toContain("project_id");
    expect(ingestFailureHint(429)).toContain("rate limit");
    expect(ingestFailureHint(404)).toContain("baseUrl");
    expect(ingestFailureHint(503)).toBeUndefined();
  });

  it("picks cf-ray, server, and date headers", () => {
    expect(
      pickResponseHeadersFromRecord({
        "CF-Ray": "abc123",
        "content-type": "application/json",
        Date: "Wed, 08 Jul 2026 18:00:00 GMT",
      }),
    ).toEqual({
      "cf-ray": "abc123",
      date: "Wed, 08 Jul 2026 18:00:00 GMT",
    });
  });
});
