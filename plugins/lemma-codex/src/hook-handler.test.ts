import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletedCodingAgentTurn } from "../../../packages/ts/tracing/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCodexHook } from "./hook-handler.js";
import { listPendingTurns, readTurn, writeCredentials } from "./storage.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lemma-codex-hook-test-"));
  temporaryDirectories.push(path);
  await writeCredentials(path, {
    version: 1,
    apiUrl: "https://api.example.test",
    projectId: "10000000-0000-0000-0000-000000000001",
    credentialId: "credential-1",
    accessToken: "lemma_ci_secret",
  });
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Codex hook turn assembly", () => {
  it("sends one complete trace per Stop and links turns by session", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    const sendTrace = vi.fn(async ({ turn }) => {
      sent.push(turn);
    });

    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "Inspect the repository",
        model: "gpt-5.6-codex",
        cwd: "/workspace",
        transcript_path: "/state/transcript.jsonl",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
      { dataDir, sendTrace },
    );
    await handleCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "exec_command",
        tool_input: { cmd: "rg --files" },
        timestamp: "2026-08-19T10:00:01.000Z",
      },
      { dataDir, sendTrace },
    );
    await handleCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "exec_command",
        tool_input: { cmd: "rg --files" },
        tool_response: { output: "package.json" },
        timestamp: "2026-08-19T10:00:02.000Z",
      },
      { dataDir, sendTrace },
    );
    await handleCodexHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "I found the package manifest.",
        timestamp: "2026-08-19T10:00:03.000Z",
      },
      { dataDir, sendTrace },
    );

    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-2",
        prompt: "Explain it",
        timestamp: "2026-08-19T10:01:00.000Z",
      },
      { dataDir, sendTrace },
    );
    await handleCodexHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-2",
        last_assistant_message: "It is a TypeScript package.",
        timestamp: "2026-08-19T10:01:01.000Z",
      },
      { dataDir, sendTrace },
    );

    expect(sent).toHaveLength(2);
    expect(sent.map((turn) => turn.sessionId)).toEqual([
      "session-1",
      "session-1",
    ]);
    expect(sent[0].traceId).not.toBe(sent[1].traceId);
    expect(sent[0]).toMatchObject({
      prompt: "Inspect the repository",
      response: "I found the package manifest.",
      model: "gpt-5.6-codex",
      metadata: {
        "lemma.harness.cwd": "/workspace",
        "lemma.harness.transcript_path": "/state/transcript.jsonl",
      },
      tools: [
        {
          toolUseId: "tool-1",
          toolName: "exec_command",
          input: { cmd: "rg --files" },
          output: { output: "package.json" },
          startedAt: "2026-08-19T10:00:01.000Z",
          endedAt: "2026-08-19T10:00:02.000Z",
        },
      ],
    });
    expect(await listPendingTurns(dataDir)).toEqual([]);
  });

  it("retains a failed Stop delivery and retries it on the next prompt", async () => {
    const dataDir = await temporaryDataDir();
    const warnings: string[] = [];
    let attempts = 0;
    const sendTrace = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("host unavailable");
    });

    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "first",
      },
      { dataDir, sendTrace },
    );
    await handleCodexHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "done",
      },
      { dataDir, sendTrace, warn: (message) => warnings.push(message) },
    );

    expect(await listPendingTurns(dataDir)).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining("retained a trace for retry"),
    ]);

    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-2",
        prompt: "second",
      },
      { dataDir, sendTrace },
    );

    expect(sendTrace).toHaveBeenCalledTimes(2);
    expect(await listPendingTurns(dataDir)).toEqual([]);
    expect(await readTurn(dataDir, "session-1", "turn-2")).toMatchObject({
      status: "open",
      prompt: "second",
    });
  });

  it("serializes concurrent tool hooks without losing calls", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "parallel tools",
      },
      { dataDir },
    );

    await Promise.all(
      ["one", "two", "three"].map((toolUseId) =>
        handleCodexHook(
          {
            hook_event_name: "PreToolUse",
            session_id: "session-1",
            turn_id: "turn-1",
            tool_use_id: toolUseId,
            tool_name: "exec_command",
            tool_input: { toolUseId },
          },
          { dataDir },
        ),
      ),
    );
    await handleCodexHook(
      {
        hook_event_name: "Stop",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "done",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools.map((tool) => tool.toolUseId).sort()).toEqual([
      "one",
      "three",
      "two",
    ]);
  });

  it("ignores explicitly identified subagent events", async () => {
    const dataDir = await temporaryDataDir();
    await expect(
      handleCodexHook(
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "sub-session",
          turn_id: "turn-1",
          agent_type: "subagent",
          prompt: "delegate",
        },
        { dataDir },
      ),
    ).resolves.toEqual({ status: "ignored" });
    expect(await readTurn(dataDir, "sub-session", "turn-1")).toBeNull();
  });
});
