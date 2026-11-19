import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lemma, SDK_USER_AGENT } from "./client";
import { SDK_PACKAGE_NAME, SDK_VERSION } from "./version";

const PROJECT_ID = "10000000-0000-0000-0000-000000000001";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

function userAgentOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit | undefined)?.headers).get(
    "user-agent",
  );
}

function lemmaWith(fetchImpl?: typeof fetch) {
  return new Lemma({
    apiKey: "key",
    projectId: PROJECT_ID,
    baseUrl: "https://api.example.test",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SDK User-Agent", () => {
  it("names the package and version in package.json", () => {
    expect(SDK_PACKAGE_NAME).toBe(packageJson.name);
    expect(SDK_VERSION).toBe(packageJson.version);
    expect(SDK_USER_AGENT).toBe(`@uselemma/tracing/${packageJson.version}`);
  });

  it("is sent on ingest through the default fetch", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await lemmaWith().trace({ name: "default-fetch", input: "hi" }, () => "ok");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(userAgentOf(fetchMock.mock.calls[0]!)).toBe(SDK_USER_AGENT);
  });

  it("is sent on ingest through a caller-supplied fetch", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));

    await lemmaWith(fetchMock as typeof fetch).trace(
      { name: "custom-fetch", input: "hi" },
      () => "ok",
    );

    expect(userAgentOf(fetchMock.mock.calls[0]!)).toBe(SDK_USER_AGENT);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer key",
      "Content-Type": "application/json",
    });
  });

  it("is sent on the smoke test's ingest and ingest-status requests", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/traces/ingest-status")
        ? new Response(JSON.stringify({ status: "enqueued" }), { status: 200 })
        : new Response("{}", { status: 201 }),
    );

    const pending = lemmaWith(fetchMock as typeof fetch).debugSmokeTest();
    await vi.runAllTimersAsync();
    await pending;

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/traces/ingest-status"))).toBe(
      true,
    );
    expect(fetchMock.mock.calls.map(userAgentOf)).toEqual(
      urls.map(() => SDK_USER_AGENT),
    );
  });

  it("lets a caller's fetch replace it", async () => {
    const sent = vi.fn(async () => new Response("{}", { status: 201 }));
    const callerFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", "acme-agent/2.0.0");
      return sent(input, { ...init, headers });
    };

    await lemmaWith(callerFetch).trace(
      { name: "caller-user-agent", input: "hi" },
      () => "ok",
    );

    expect(userAgentOf(sent.mock.calls[0]!)).toBe("acme-agent/2.0.0");
    expect(
      new Headers((sent.mock.calls[0]![1] as RequestInit).headers).get(
        "authorization",
      ),
    ).toBe("Bearer key");
  });
});
