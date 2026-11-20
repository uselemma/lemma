import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lemma, type LemmaClientOptions } from "./client";
import { SDK_USER_AGENT } from "./version";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

const PLUGIN_USER_AGENT = "@uselemma/example-plugin/1.2.3";

function userAgentOf(call: Parameters<typeof fetch>): string | null {
  return new Headers(call[1]?.headers).get("user-agent");
}

function lemmaWith(
  fetchImpl: typeof fetch,
  options: Pick<LemmaClientOptions, "userAgent"> = {},
) {
  return new Lemma({
    apiKey: "key",
    projectId: "10000000-0000-0000-0000-000000000001",
    baseUrl: "https://api.example.test",
    fetch: fetchImpl,
    ...options,
  });
}

function ingestMock() {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status: 201 }));
}

async function ingestOnce(lemma: Lemma) {
  await lemma.trace({ name: "ingest", input: "hi" }, () => "ok");
}

async function smokeTestCalls(options: Pick<LemmaClientOptions, "userAgent">) {
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/traces/ingest-status")
      ? new Response(JSON.stringify({ status: "enqueued" }), { status: 200 })
      : new Response("{}", { status: 201 }),
  );

  const pending = lemmaWith(fetchMock, options).debugSmokeTest();
  await vi.runAllTimersAsync();
  await pending;

  const status = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/traces/ingest-status"),
  );
  const ingest = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/traces/ingest"),
  );
  return { ingest, status };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SDK User-Agent", () => {
  it("names the package and version in package.json", () => {
    expect(SDK_USER_AGENT).toBe(`${packageJson.name}/${packageJson.version}`);
  });

  it("is sent on ingest through a caller-supplied fetch", async () => {
    const fetchMock = ingestMock();

    await ingestOnce(lemmaWith(fetchMock));

    expect(userAgentOf(fetchMock.mock.calls[0]!)).toBe(SDK_USER_AGENT);
  });

  it("is sent on ingest-status", async () => {
    const { status } = await smokeTestCalls({});

    expect(status && userAgentOf(status)).toBe(SDK_USER_AGENT);
  });
});

describe("userAgent option", () => {
  it("replaces the SDK User-Agent on ingest", async () => {
    const fetchMock = ingestMock();

    await ingestOnce(lemmaWith(fetchMock, { userAgent: PLUGIN_USER_AGENT }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(userAgentOf(fetchMock.mock.calls[0]!)).toBe(PLUGIN_USER_AGENT);
  });

  it("replaces the SDK User-Agent on smoke-test ingest and ingest-status", async () => {
    const { ingest, status } = await smokeTestCalls({
      userAgent: PLUGIN_USER_AGENT,
    });

    expect(ingest && userAgentOf(ingest)).toBe(PLUGIN_USER_AGENT);
    expect(status && userAgentOf(status)).toBe(PLUGIN_USER_AGENT);
  });

  it("keeps the credentials beside it", async () => {
    const fetchMock = ingestMock();

    await ingestOnce(lemmaWith(fetchMock, { userAgent: PLUGIN_USER_AGENT }));

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer key");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("yields to a caller-supplied fetch that sets its own User-Agent", async () => {
    const send = ingestMock();
    const relabel: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", "my-app/1.0.0");
      return send(input, { ...init, headers });
    };

    await ingestOnce(lemmaWith(relabel, { userAgent: PLUGIN_USER_AGENT }));

    expect(userAgentOf(send.mock.calls[0]!)).toBe("my-app/1.0.0");
  });
});
