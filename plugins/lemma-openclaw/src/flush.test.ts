import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { codingAgentTurnTrace } from "../../../packages/ts/tracing/src/index.js";

import { flushPendingTurns, mapOpenClawTurn } from "./flush.js";
import { writeCredentials } from "./storage.js";
import type { PendingOpenClawTurn } from "./types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function pendingTurn(): PendingOpenClawTurn {
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
      model: "claude-sonnet",
      provider: "anthropic",
      tools: [
        {
          toolUseId: "tool-1",
          toolName: "exec",
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
  const dataDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-flush-"));
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

describe("OpenClaw turn mapping", () => {
  it("maps native hooks through the shared coding-agent mapper", () => {
    const turn = mapOpenClawTurn(pendingTurn().turn);
    expect(turn).toMatchObject({
      harness: "openclaw",
      sessionId: "session-1",
      turnId: "turn-1",
      status: "completed",
      response: "The test now passes.",
      tools: [{ toolUseId: "tool-1", toolName: "exec" }],
    });
    const trace = codingAgentTurnTrace(turn);
    expect(
      trace.context.toPayload(
        "10000000-0000-0000-0000-000000000001",
        new Date(trace.startedAt),
        new Date(trace.endedAt),
      ),
    ).toMatchObject({
      trace: {
        input: "Fix the test",
        output: "The test now passes.",
        thread_id: "session-1",
        spans: expect.arrayContaining([
          expect.objectContaining({ type: "tool", tool_name: "exec" }),
          expect.objectContaining({
            type: "generation",
            model: "claude-sonnet",
          }),
        ]),
      },
    });
  });

  it("serializes concurrent pending delivery flushes", async () => {
    const dataDir = await temporaryDataDir();
    let releaseRequest: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolveResponse) => {
          releaseRequest = () =>
            resolveResponse(new Response("{}", { status: 201 }));
        }),
    );

    const firstFlush = flushPendingTurns({ dataDir, fetch: fetchMock });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await flushPendingTurns({ dataDir, fetch: fetchMock })).toBe(0);
    releaseRequest?.();

    expect(await firstFlush).toBe(1);
    expect(await readdir(join(dataDir, "pending"))).toEqual([]);
  });

  it("drains turns queued while another delivery is active", async () => {
    const dataDir = await temporaryDataDir();
    let releaseRequest: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        fetchMock.mock.calls.length === 1
          ? new Promise<Response>((resolveResponse) => {
              releaseRequest = () =>
                resolveResponse(new Response("{}", { status: 201 }));
            })
          : Promise.resolve(new Response("{}", { status: 201 })),
    );

    const flush = flushPendingTurns({ dataDir, fetch: fetchMock });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = pendingTurn();
    second.turn.turnId = "turn-2";
    await writeFile(
      join(dataDir, "pending", "turn-2.json"),
      `${JSON.stringify(second)}\n`,
    );
    expect(await flushPendingTurns({ dataDir, fetch: fetchMock })).toBe(0);
    releaseRequest?.();

    expect(await flush).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readdir(join(dataDir, "pending"))).toEqual([]);
  });

  it("does not steal an old lock owned by a running process", async () => {
    const dataDir = await temporaryDataDir();
    const lockDir = join(dataDir, "flush.lock");
    await mkdir(lockDir);
    await writeFile(
      join(lockDir, "owner.json"),
      `${JSON.stringify({ pid: process.pid, id: "active-owner" })}\n`,
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(lockDir, old, old);
    const fetchMock = vi.fn<typeof fetch>();

    expect(await flushPendingTurns({ dataDir, fetch: fetchMock })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains failures without logging credentials or response bodies", async () => {
    const dataDir = await temporaryDataDir();
    const warnings: string[] = [];
    expect(
      await flushPendingTurns({
        dataDir,
        fetch: async () =>
          new Response("lemma_ci_scoped-secret private-body", { status: 401 }),
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);

    expect(warnings).toEqual([
      "Lemma OpenClaw retained a trace for retry (turn.json).",
    ]);
    expect(warnings.join("\n")).not.toContain("lemma_ci_scoped-secret");
    expect(warnings.join("\n")).not.toContain("private-body");
    expect(await readFile(join(dataDir, "pending", "turn.json"), "utf8"))
      .toContain("turn-1");
  });
});
