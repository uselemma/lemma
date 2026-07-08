import { describe, expect, it } from "vitest";
import {
  apiKeySuffix,
  buildConfigWarnings,
  ingestFailureHint,
  isValidProjectId,
  pickResponseHeadersFromRecord,
  PRODUCTION_BASE_URL,
} from "./debug-delivery";

describe("debug-delivery", () => {
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
