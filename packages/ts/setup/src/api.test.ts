import { afterEach, describe, expect, it } from "vitest";

import { describeApiKey, pollSetupAuthorization } from "./api.js";
import {
  approved,
  denied,
  DEVICE_CODE,
  expired,
  keyDescription,
  MockApi,
  pending,
  plainNotFound,
  slowDown,
  type MockApiOptions,
} from "./testing/mock-api.js";

const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
const TENANT_ID = "9b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

describe("the API client", () => {
  let api: MockApi | null = null;

  afterEach(async () => {
    await api?.close();
    api = null;
  });

  async function pollOnce(polls: MockApiOptions["polls"]) {
    await api?.close();
    api = await new MockApi({ polls }).listen();
    return pollSetupAuthorization(api.url, DEVICE_CODE, fetch);
  }

  it("sends the device code and reads each handshake answer", async () => {
    await expect(pollOnce([pending])).resolves.toEqual({
      status: "authorization_pending",
      interval: 5,
    });
    expect(api?.requests[0]).toMatchObject({
      method: "POST",
      path: "/setup/device-authorizations/token",
      body: { device_code: DEVICE_CODE },
    });
    await expect(pollOnce([slowDown])).resolves.toEqual({
      status: "slow_down",
      interval: 5,
    });
    await expect(pollOnce([expired])).resolves.toEqual({
      status: "expired_token",
    });
    await expect(pollOnce([denied])).resolves.toEqual({
      status: "access_denied",
    });
  });

  it("tells a rate-limit refusal from slow_down, and a plain 404 from the typed not-found", async () => {
    await expect(
      pollOnce([
        { status: 429, body: { detail: "Too many login polling attempts" } },
      ]),
    ).resolves.toEqual({
      status: "error",
      retryable: false,
      message: "Lemma setup polling failed: Too many login polling attempts",
    });
    await expect(
      pollOnce([
        { status: 503, body: { detail: "Login service is unavailable" } },
      ]),
    ).resolves.toMatchObject({ status: "error", retryable: true });
    await expect(pollOnce([plainNotFound])).resolves.toEqual({
      status: "unavailable",
    });
    await expect(
      pollOnce([
        {
          status: 404,
          body: {
            detail: "No setup matches this code.",
            code: "setup_authorization_not_found",
          },
        },
      ]),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("types the ingest key of an approval as new or kept, with or without an MCP key beside it", async () => {
    const approval = {
      projectId: PROJECT_ID,
      agentName: "support-bot",
      ingest: { kind: "new", key: "lemma_sk_ingest_0123456789abcdef" },
    };
    await expect(
      pollOnce([
        approved({
          project_id: PROJECT_ID,
          agent_name: "support-bot",
          harness: "claude-code",
          ingest_key: "lemma_sk_ingest_0123456789abcdef",
        }),
      ]),
    ).resolves.toEqual({ status: "approved", approval });
    await expect(
      pollOnce([
        approved({
          project_id: PROJECT_ID,
          agent_name: "support-bot",
          mcp_key: "lemma_sk_admin_0123456789abcdef",
        }),
      ]),
    ).resolves.toEqual({
      status: "approved",
      approval: { ...approval, ingest: { kind: "kept" } },
    });
  });

  it("refuses an approval whose key could not be written to a file safely", async () => {
    await expect(
      pollOnce([
        approved({
          project_id: PROJECT_ID,
          agent_name: "support-bot",
          ingest_key: "lemma_sk_x\nINJECTED=1",
        }),
      ]),
    ).resolves.toMatchObject({ status: "error", retryable: false });
  });

  it("describes a key from /auth/key and treats any other answer as unverified", async () => {
    api = await new MockApi({
      keys: {
        lemma_sk_admin_0123456789abcdef: keyDescription(
          TENANT_ID,
          null,
          "admin",
        ),
        lemma_sk_broken_0123456789abcd: {
          status: 200,
          body: { scope: "owner" },
        },
        lemma_sk_flag_off_0123456789ab: plainNotFound,
      },
    }).listen();
    await expect(
      describeApiKey(api.url, "lemma_sk_admin_0123456789abcdef", fetch),
    ).resolves.toEqual({ projectId: null, scope: "admin" });
    expect(api.requests[0].headers.authorization).toBe(
      "Bearer lemma_sk_admin_0123456789abcdef",
    );
    await expect(
      describeApiKey(api.url, "lemma_sk_broken_0123456789abcd", fetch),
    ).resolves.toBeNull();
    await expect(
      describeApiKey(api.url, "lemma_sk_flag_off_0123456789ab", fetch),
    ).resolves.toBeNull();
    await expect(
      describeApiKey(api.url, "lemma_sk_unknown_0123456789abc", fetch),
    ).resolves.toBeNull();
    await api.close();
    await expect(
      describeApiKey(api.url, "lemma_sk_admin_0123456789abcdef", fetch),
    ).resolves.toBeNull();
  });
});
