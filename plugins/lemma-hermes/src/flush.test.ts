import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { codingAgentTurnTrace } from "../../../packages/ts/tracing/src/index.js";

import { writeCredentials } from "./credentials.js";
import { flushPendingTurns, mapHermesTurn } from "./flush.js";
import type { PendingHermesTurn } from "./types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function pendingTurn(): PendingHermesTurn {
  return {
    version: 1,
    apiUrl: "https://dev.api.uselemma.ai",
    projectId: "10000000-0000-0000-0000-000000000001",
    turn: {
      version: 1,
      sessionId: "session-1",
      turnId: "turn-1",
      prompt: "Fix the test",
      response: "The test now passes.",
      startedAt: "2026-08-21T01:00:00.000Z",
      endedAt: "2026-08-21T01:00:03.000Z",
      generationStartedAt: "2026-08-21T01:00:00.100Z",
      generationEndedAt: "2026-08-21T01:00:02.900Z",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      tools: [
        {
          toolUseId: "tool-1",
          toolName: "terminal",
          input: { command: "pnpm test" },
          output: { exitCode: 0 },
          startedAt: "2026-08-21T01:00:01.000Z",
          endedAt: "2026-08-21T01:00:02.000Z",
        },
      ],
    },
  };
}

async function temporaryDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "lemma-hermes-flush-"));
  directories.push(dataDir);
  await writeCredentials(
    {
      version: 1,
      apiUrl: "https://dev.api.uselemma.ai",
      projectId: "10000000-0000-0000-0000-000000000001",
      credentialId: "credential-1",
      accessToken: "lemma_ci_scoped-secret",
    },
    { dataDir },
  );
  await mkdir(join(dataDir, "pending"), { recursive: true });
  await writeFile(
    join(dataDir, "pending", "turn.json"),
    `${JSON.stringify(pendingTurn())}\n`,
  );
  return dataDir;
}

describe("Hermes turn mapping", () => {
  it("maps a completed native turn through the shared coding-agent mapper", () => {
    const turn = mapHermesTurn(pendingTurn().turn);

    expect(turn).toMatchObject({
      harness: "hermes",
      sessionId: "session-1",
      turnId: "turn-1",
      status: "completed",
      response: "The test now passes.",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      tools: [{ toolUseId: "tool-1", toolName: "terminal" }],
    });

    const trace = codingAgentTurnTrace(turn);
    expect(
      trace.context.toPayload(
        "10000000-0000-0000-0000-000000000001",
        new Date(trace.startedAt),
        new Date(trace.endedAt),
      ),
    ).toMatchObject({
      project_id: "10000000-0000-0000-0000-000000000001",
      trace: {
        input: "Fix the test",
        output: "The test now passes.",
        thread_id: "session-1",
        spans: [
          expect.objectContaining({ type: "tool", tool_name: "terminal" }),
          expect.objectContaining({
            type: "generation",
            model: "claude-sonnet-4-6",
          }),
        ],
      },
    });
  });

  it("serializes concurrent pending delivery flushes", async () => {
    const dataDir = await temporaryDataDir();
    let releaseRequest: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseRequest = () => resolve(new Response("{}", { status: 201 }));
        }),
    );

    const firstFlush = flushPendingTurns({ dataDir, fetch: fetchMock });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await flushPendingTurns({ dataDir, fetch: fetchMock })).toBe(0);
    releaseRequest?.();

    expect(await firstFlush).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await readdir(join(dataDir, "pending"))).toEqual([]);
  });

  it("retains failed traces without logging credentials or response bodies", async () => {
    const dataDir = await temporaryDataDir();
    const warnings: string[] = [];
    const responseBody = "server echoed lemma_ci_scoped-secret and private-body";

    expect(
      await flushPendingTurns({
        dataDir,
        fetch: async () => new Response(responseBody, { status: 401 }),
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);

    expect(warnings).toEqual([
      "Lemma Hermes retained a trace for retry (turn.json).",
    ]);
    expect(warnings.join("\n")).not.toContain("lemma_ci_scoped-secret");
    expect(warnings.join("\n")).not.toContain("private-body");
    expect(await readFile(join(dataDir, "pending", "turn.json"), "utf8"))
      .toContain("turn-1");
  });
});
