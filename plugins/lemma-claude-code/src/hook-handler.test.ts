import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletedCodingAgentTurn } from "../../../packages/ts/tracing/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPendingTurns, handleClaudeHook } from "./hook-handler.js";
import { listPendingTurns, writeCredentials } from "./storage.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(withCredentials = true): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lemma-claude-hook-test-"));
  temporaryDirectories.push(path);
  if (withCredentials) {
    await writeCredentials(path, {
      version: 1,
      apiUrl: "https://api.example.test",
      projectId: "10000000-0000-0000-0000-000000000001",
      credentialId: "credential-1",
      accessToken: "lemma_ci_secret",
    });
  }
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Claude Code hook turn assembly", () => {
  it("binds a staged prompt to prompt_id and sends one complete trace", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    const sendTrace = vi.fn(async ({ turn }) => {
      sent.push(turn);
    });

    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt: "Inspect the repository",
        cwd: "/workspace",
        transcript_path: "/state/transcript.jsonl",
        timestamp: "2026-08-20T10:00:00.000Z",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        prompt_id: "prompt-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        tool_input: { command: "rg --files" },
        timestamp: "2026-08-20T10:00:01.000Z",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        prompt_id: "prompt-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        tool_input: { command: "rg --files" },
        tool_response: { stdout: "package.json", exit_code: 0 },
        timestamp: "2026-08-20T10:00:02.000Z",
      },
      { dataDir },
    );
    const result = await handleClaudeHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        prompt_id: "prompt-1",
        last_assistant_message: "I found the package manifest.",
        model: "claude-opus-4-1",
        timestamp: "2026-08-20T10:00:03.000Z",
      },
      { dataDir },
    );

    expect(result.status).toBe("queued");
    expect(await flushPendingTurns({ dataDir, sendTrace })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      harness: "claude-code",
      sessionId: "session-1",
      turnId: "prompt-1",
      prompt: "Inspect the repository",
      response: "I found the package manifest.",
      provider: "anthropic",
      model: "claude-opus-4-1",
      metadata: {
        "lemma.harness.cwd": "/workspace",
        "lemma.harness.transcript_path": "/state/transcript.jsonl",
      },
      tools: [
        {
          toolUseId: "tool-1",
          toolName: "Bash",
          input: { command: "rg --files" },
          output: { stdout: "package.json", exit_code: 0 },
          startedAt: "2026-08-20T10:00:01.000Z",
          endedAt: "2026-08-20T10:00:02.000Z",
        },
      ],
    });
    expect(await listPendingTurns(dataDir)).toEqual([]);
  });

  it("retains failed delivery for a later retry", async () => {
    const dataDir = await temporaryDataDir();
    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt_id: "prompt-1",
        prompt: "Hello",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        prompt_id: "prompt-1",
        last_assistant_message: "Hi",
      },
      { dataDir },
    );

    const warnings: string[] = [];
    expect(
      await flushPendingTurns({
        dataDir,
        sendTrace: async () => {
          throw new Error("host unavailable");
        },
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);
    expect(await listPendingTurns(dataDir)).toHaveLength(1);
    expect(warnings.join("\n")).toContain("retained a trace for retry");

    expect(
      await flushPendingTurns({ dataDir, sendTrace: async () => undefined }),
    ).toBe(1);
    expect(await listPendingTurns(dataDir)).toEqual([]);
  });

  it("records failed tool executions before completing the turn", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];

    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt_id: "prompt-1",
        prompt: "Run the test suite",
        timestamp: "2026-08-20T10:00:00.000Z",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        prompt_id: "prompt-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        timestamp: "2026-08-20T10:00:01.000Z",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "PostToolUseFailure",
        session_id: "session-1",
        prompt_id: "prompt-1",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        error: "Process exited with code 1",
        timestamp: "2026-08-20T10:00:02.000Z",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        prompt_id: "prompt-1",
        last_assistant_message: "The test suite failed.",
        timestamp: "2026-08-20T10:00:03.000Z",
      },
      { dataDir },
    );

    await flushPendingTurns({
      dataDir,
      sendTrace: async ({ turn }) => {
        sent.push(turn);
      },
    });

    expect(sent[0]?.tools).toEqual([
      {
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "pnpm test" },
        error: "Process exited with code 1",
        startedAt: "2026-08-20T10:00:01.000Z",
        endedAt: "2026-08-20T10:00:02.000Z",
      },
    ]);
  });

  it("keeps repeated Stop events on one pending delivery", async () => {
    const dataDir = await temporaryDataDir();
    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt_id: "prompt-1",
        prompt: "Hello",
      },
      { dataDir },
    );
    const stop = {
      hook_event_name: "Stop",
      session_id: "session-1",
      prompt_id: "prompt-1",
      last_assistant_message: "Hi",
    };

    await handleClaudeHook(stop, { dataDir });
    const [first] = await listPendingTurns(dataDir);
    await handleClaudeHook(stop, { dataDir });
    const [second] = await listPendingTurns(dataDir);

    expect(second.deliveryId).toBe(first.deliveryId);
    const sendTrace = vi.fn(async () => undefined);
    expect(await flushPendingTurns({ dataDir, sendTrace })).toBe(1);
    expect(sendTrace).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent pending delivery flushes", async () => {
    const dataDir = await temporaryDataDir();
    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt_id: "prompt-1",
        prompt: "Hello",
      },
      { dataDir },
    );
    await handleClaudeHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        prompt_id: "prompt-1",
        last_assistant_message: "Hi",
      },
      { dataDir },
    );

    const sendTrace = vi.fn(async () => undefined);
    await Promise.all([
      flushPendingTurns({ dataDir, sendTrace }),
      flushPendingTurns({ dataDir, sendTrace }),
    ]);

    expect(sendTrace).toHaveBeenCalledTimes(1);
    expect(await listPendingTurns(dataDir)).toEqual([]);
  });

  it("fails open when setup has not stored credentials", async () => {
    const dataDir = await temporaryDataDir(false);
    const warnings: string[] = [];
    await handleClaudeHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        prompt_id: "prompt-1",
        prompt: "Hello",
      },
      { dataDir },
    );
    const result = await handleClaudeHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        prompt_id: "prompt-1",
        last_assistant_message: "Hi",
      },
      { dataDir, warn: (message) => warnings.push(message) },
    );
    expect(result.status).toBe("ignored");
    expect(warnings.join("\n")).toContain("setup is incomplete");
  });
});
