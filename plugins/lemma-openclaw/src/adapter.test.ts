import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenClawAdapter } from "./adapter.js";
import { writeCredentials } from "./storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenClaw adapter", () => {
  it("captures one completed turn with sanitized tool activity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-adapter-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const spawnFlush = vi.fn();
    const adapter = createOpenClawAdapter({
      dataDir,
      now: vi
        .fn<() => string>()
        .mockReturnValueOnce("2026-08-21T01:00:00.000Z")
        .mockReturnValueOnce("2026-08-21T01:00:01.000Z")
        .mockReturnValueOnce("2026-08-21T01:00:02.000Z")
        .mockReturnValueOnce("2026-08-21T01:00:03.000Z"),
      spawnFlush,
    });

    adapter.beforeAgentRun(
      { prompt: "Fix the test with api_key=private-key", messages: [] },
      {
        runId: "run-1",
        sessionId: "session-1",
        modelProviderId: "anthropic",
        modelId: "claude-sonnet",
      },
    );
    adapter.beforeToolCall(
      {
        toolName: "exec",
        toolCallId: "tool-1",
        runId: "run-1",
        params: { command: "pnpm test", token: "secret" },
      },
      { runId: "run-1", toolName: "exec" },
    );
    adapter.afterToolCall(
      {
        toolName: "exec",
        toolCallId: "tool-1",
        runId: "run-1",
        params: { command: "pnpm test" },
        result: { exitCode: 0 },
      },
      { runId: "run-1", toolName: "exec" },
    );
    await adapter.agentEnd(
      {
        runId: "run-1",
        success: true,
        messages: [
          {
            role: "assistant",
            content: "The test passes with Bearer private-token.",
          },
        ],
      },
      { runId: "run-1", sessionId: "session-1" },
    );

    expect(adapter.pendingTurnCount()).toBe(0);
    expect(spawnFlush).toHaveBeenCalledOnce();
    const pendingFiles = await readdir(join(dataDir, "pending"));
    expect(pendingFiles).toHaveLength(1);
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", pendingFiles[0]), "utf8"),
    ) as {
      turn: {
        prompt: string;
        response: string;
        tools: Array<{ input?: Record<string, unknown>; output?: unknown }>;
      };
    };
    expect(pending.turn).toMatchObject({
      prompt: "Fix the test with api_key=[REDACTED]",
      response: "The test passes with Bearer [REDACTED]",
      tools: [
        {
          input: { command: "pnpm test" },
          output: { exitCode: 0 },
        },
      ],
    });
    expect(pending.turn.tools[0].input).not.toHaveProperty("token");
  });
});
