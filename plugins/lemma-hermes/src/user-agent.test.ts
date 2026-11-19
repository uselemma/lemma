import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeliveryFetch } from "./delivery.js";
import { PLUGIN_USER_AGENT, withPluginUserAgent } from "./user-agent.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

// The tracing SDK's own User-Agent, which this plugin's requests replace.
const SDK_INIT: RequestInit = {
  headers: {
    "User-Agent": "@uselemma/tracing/7.13.1",
    Authorization: "Bearer lemma_ci_secret",
  },
};

function userAgentOf(call: unknown[] | undefined): string | null {
  return new Headers((call?.[1] as RequestInit | undefined)?.headers).get(
    "user-agent",
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
});

describe("Hermes User-Agent", () => {
  it("names this package and its version", () => {
    expect(PLUGIN_USER_AGENT).toBe(
      `${packageJson.name}/${packageJson.version}`,
    );
  });

  it("replaces the tracing SDK's User-Agent and keeps the other headers", () => {
    expect(withPluginUserAgent(SDK_INIT).headers).toEqual({
      Authorization: "Bearer lemma_ci_secret",
      "User-Agent": PLUGIN_USER_AGENT,
    });
    expect(
      withPluginUserAgent({ headers: { "user-agent": "other/1.0.0" } }).headers,
    ).toEqual({ "User-Agent": PLUGIN_USER_AGENT });
    const fromHeaders = new Headers(
      withPluginUserAgent({ headers: new Headers(SDK_INIT.headers) }).headers,
    );
    expect(fromHeaders.get("user-agent")).toBe(PLUGIN_USER_AGENT);
    expect(fromHeaders.get("authorization")).toBe("Bearer lemma_ci_secret");
  });

  it("is sent on trace delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );

    await createDeliveryFetch(fetchMock)(
      "https://api.example.test/traces/ingest",
      SDK_INIT,
    );

    expect(userAgentOf(fetchMock.mock.calls[0])).toBe(PLUGIN_USER_AGENT);
    expect(
      new Headers(
        (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
      ).get("authorization"),
    ).toBe("Bearer lemma_ci_secret");
  });
});
