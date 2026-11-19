import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeCodingAgentTurn,
  startCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPendingTurns } from "./hook-handler.js";
import { queueCompletedTurn, writeCredentials } from "./storage.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Claude Code User-Agent", () => {
  it("replaces the tracing SDK's User-Agent on trace delivery", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "lemma-claude-code-user-agent-"),
    );
    temporaryDirectories.push(dataDir);
    const destination = {
      apiUrl: "https://api.example.test",
      projectId: "10000000-0000-0000-0000-000000000001",
    };
    await writeCredentials(dataDir, {
      version: 1,
      ...destination,
      credentialId: "credential-1",
      accessToken: "lemma_ci_secret",
    });
    const turn = completeCodingAgentTurn(
      startCodingAgentTurn({
        harness: "claude-code",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "Inspect the repository",
        startedAt: "2026-11-18T10:00:00.000Z",
      }),
      { response: "Done.", endedAt: "2026-11-18T10:00:01.000Z" },
    );
    await queueCompletedTurn(dataDir, turn, destination);
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingTurns({ dataDir })).toBe(1);

    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("user-agent"),
    ).toBe(`${packageJson.name}/${packageJson.version}`);
  });
});
