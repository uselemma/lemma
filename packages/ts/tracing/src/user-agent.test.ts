import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lemma } from "./client";
import { SDK_USER_AGENT } from "./version";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

function userAgentOf(call: Parameters<typeof fetch>): string | null {
  return new Headers(call[1]?.headers).get("user-agent");
}

function lemmaWith(fetchImpl: typeof fetch) {
  return new Lemma({
    apiKey: "key",
    projectId: "10000000-0000-0000-0000-000000000001",
    baseUrl: "https://api.example.test",
    fetch: fetchImpl,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SDK User-Agent", () => {
  it("names the package and version in package.json", () => {
    expect(SDK_USER_AGENT).toBe(`${packageJson.name}/${packageJson.version}`);
  });

  it("is sent on ingest through a caller-supplied fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );

    await lemmaWith(fetchMock).trace(
      { name: "ingest", input: "hi" },
      () => "ok",
    );

    expect(userAgentOf(fetchMock.mock.calls[0]!)).toBe(SDK_USER_AGENT);
  });

  it("is sent on ingest-status", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/traces/ingest-status")
        ? new Response(JSON.stringify({ status: "enqueued" }), { status: 200 })
        : new Response("{}", { status: 201 }),
    );

    const pending = lemmaWith(fetchMock).debugSmokeTest();
    await vi.runAllTimersAsync();
    await pending;

    const status = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/traces/ingest-status"),
    );
    expect(status && userAgentOf(status)).toBe(SDK_USER_AGENT);
  });
});
