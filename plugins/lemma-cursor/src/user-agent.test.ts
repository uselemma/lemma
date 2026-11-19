import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeCodingAgentTurn,
  startCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";
import { SDK_USER_AGENT } from "../../../packages/ts/tracing/src/client.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPendingTurns } from "./hook-handler.js";
import { queueCompletedTurn, writeCredentials } from "./storage.js";
import { PLUGIN_USER_AGENT, withPluginUserAgent } from "./user-agent.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

// The tracing SDK's own User-Agent, which this plugin's requests replace.
const SDK_INIT: RequestInit = {
  headers: {
    "User-Agent": SDK_USER_AGENT,
    Authorization: "Bearer lemma_ci_secret",
  },
};

function userAgentOf(call: unknown[] | undefined): string | null {
  return new Headers((call?.[1] as RequestInit | undefined)?.headers).get(
    "user-agent",
  );
}

const temporaryDirectories: string[] = [];
const DESTINATION = {
  apiUrl: "https://api.example.test",
  projectId: "10000000-0000-0000-0000-000000000001",
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Cursor User-Agent", () => {
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
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-cursor-user-agent-"));
    temporaryDirectories.push(dataDir);
    await writeCredentials(dataDir, {
      version: 1,
      ...DESTINATION,
      credentialId: "credential-1",
      accessToken: "lemma_ci_secret",
    });
    const turn = completeCodingAgentTurn(
      startCodingAgentTurn({
        harness: "cursor",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "Inspect the repository",
        startedAt: "2026-11-18T10:00:00.000Z",
      }),
      { response: "Done.", endedAt: "2026-11-18T10:00:01.000Z" },
    );
    await queueCompletedTurn(dataDir, turn, DESTINATION);
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingTurns({ dataDir })).toBe(1);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/traces/ingest",
    );
    expect(userAgentOf(fetchMock.mock.calls[0])).toBe(PLUGIN_USER_AGENT);
  });
});
