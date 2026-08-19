import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletedCodingAgentTurn } from "../../../packages/ts/tracing/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPendingTurns, handleCodexHook } from "./hook-handler.js";
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
  it("sends one complete trace per authoritative completion notification and links turns by session", async () => {
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
        type: "agent-turn-complete",
        "thread-id": "session-1",
        "turn-id": "turn-1",
        "last-assistant-message": "I found the package manifest.",
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
        type: "agent-turn-complete",
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

  it("retains a failed completion delivery and retries it on the next prompt", async () => {
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
        type: "agent-turn-complete",
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

  it("persists a new prompt before awaiting a slow retry", async () => {
    const dataDir = await temporaryDataDir();
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "first",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "done",
      },
      { dataDir, sendTrace: async () => Promise.reject(new Error("offline")) },
    );

    let releaseRetry: (() => void) | undefined;
    const retry = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const promptHook = handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-2",
        prompt: "second",
      },
      { dataDir, sendTrace: async () => retry },
    );

    await vi.waitFor(async () => {
      await expect(
        readTurn(dataDir, "session-1", "turn-2"),
      ).resolves.toMatchObject({ status: "open", prompt: "second" });
    });
    releaseRetry?.();
    await promptHook;
  });

  it("keeps failed traces bound to their original project", async () => {
    const dataDir = await temporaryDataDir();
    const sendTrace = vi.fn(async () => Promise.reject(new Error("offline")));
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "private project one prompt",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "private project one response",
      },
      { dataDir, sendTrace },
    );
    await writeCredentials(dataDir, {
      version: 1,
      apiUrl: "https://api.example.test",
      projectId: "20000000-0000-0000-0000-000000000002",
      credentialId: "credential-2",
      accessToken: "lemma_ci_secret_two",
    });
    const warnings: string[] = [];

    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-2",
        prompt: "project two prompt",
      },
      { dataDir, sendTrace, warn: (message) => warnings.push(message) },
    );

    expect(sendTrace).toHaveBeenCalledTimes(1);
    expect(await listPendingTurns(dataDir)).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining("another configured project"),
    ]);
  });

  it("continues flushing after one pending trace fails", async () => {
    const dataDir = await temporaryDataDir();
    for (const turnId of ["turn-1", "turn-2"]) {
      await handleCodexHook(
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "session-1",
          turn_id: turnId,
          prompt: turnId,
        },
        { dataDir },
      );
      await handleCodexHook(
        {
          type: "agent-turn-complete",
          session_id: "session-1",
          turn_id: turnId,
          last_assistant_message: "done",
        },
        {
          dataDir,
          sendTrace: async () => Promise.reject(new Error("offline")),
        },
      );
    }

    const warnings: string[] = [];
    const sent = await flushPendingTurns({
      dataDir,
      sendTrace: async ({ turn }) => {
        if (turn.turnId === "turn-1") throw new Error("rejected");
      },
      warn: (message) => warnings.push(message),
    });

    expect(sent).toBe(1);
    expect(
      (await listPendingTurns(dataDir)).map(({ turn }) => turn.turnId),
    ).toEqual(["turn-1"]);
    expect(warnings).toEqual([expect.stringContaining("rejected")]);
  });

  it("marks MCP tool results with isError as failed", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "call MCP",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "mcp__example__read",
        tool_input: { id: "missing" },
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "mcp__example__read",
        tool_response: {
          isError: true,
          content: [{ type: "text", text: "missing" }],
        },
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The tool failed.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0].error).toContain('"isError":true');
  });

  it("does not treat exit-code-shaped MCP data as a command failure", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "read remote metadata",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "mcp__example__read",
        tool_response: {
          content: [{ type: "text", text: "exit code: 7" }],
          exit_code: 7,
        },
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The metadata was read.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0].error).toBeUndefined();
  });

  it("uses the orchestrator status instead of nested exit-code-shaped data", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "read an API response",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "functions.exec",
        tool_response: [
          { type: "input_text", text: "Script completed\n" },
          { type: "input_text", text: '{"exit_code":7}' },
        ],
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The API response was returned.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0].error).toBeUndefined();
  });

  it("marks nonzero command exits found in the Codex transcript as failed", async () => {
    const dataDir = await temporaryDataDir();
    const transcriptPath = join(dataDir, "transcript.jsonl");
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "run a failing command",
        transcript_path: transcriptPath,
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "call-1",
        tool_name: "exec_command",
        tool_response: "command output",
      },
      { dataDir },
    );
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output:
            "Chunk ID: abc\nProcess exited with code 7\nFinal output:\nfailed",
        },
      })}\n`,
      "utf8",
    );

    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The command failed.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0]).toMatchObject({
      output: "command output",
      error: "Process exited with code 7",
    });
  });

  it("recovers a missing non-command result from a custom-tool transcript", async () => {
    const dataDir = await temporaryDataDir();
    const transcriptPath = join(dataDir, "transcript.jsonl");
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "fetch a page",
        transcript_path: transcriptPath,
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "call-1",
        tool_name: "mcp__example__fetch",
        tool_input: { id: "page-1" },
      },
      { dataDir },
    );
    const recoveredOutput = {
      isError: true,
      content: [{ type: "text", text: "page not found" }],
    };
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-1",
          output: recoveredOutput,
        },
      })}\n`,
      "utf8",
    );

    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The page was unavailable.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0]).toMatchObject({
      output: recoveredOutput,
      endedAt: expect.any(String),
    });
    expect(sent[0].tools[0].error).toContain('"isError":true');
  });

  it("records every prompt submitted while Codex steers the same turn", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    for (const prompt of ["Implement the change", "Also keep Linux working"]) {
      await handleCodexHook(
        {
          hook_event_name: "UserPromptSubmit",
          session_id: "session-1",
          turn_id: "turn-1",
          prompt,
        },
        { dataDir },
      );
    }
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "Done.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].prompt).toBe(
      "Implement the change\n\nAlso keep Linux working",
    );
  });

  it("does not finalize from a Stop hook before Codex confirms turn completion", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "finish the work",
      },
      { dataDir },
    );
    await expect(
      handleCodexHook(
        {
          hook_event_name: "Stop",
          session_id: "session-1",
          turn_id: "turn-1",
          last_assistant_message: "Initial response",
          stop_hook_active: false,
        },
        { dataDir },
      ),
    ).resolves.toEqual({ status: "ignored" });
    expect(await listPendingTurns(dataDir)).toEqual([]);

    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "Final continued response",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].response).toBe("Final continued response");
    await expect(readTurn(dataDir, "session-1", "turn-1")).resolves.toBeNull();
  });

  it("marks tools without a PostToolUse result as missing telemetry", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "run a blocked tool",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "tool-1",
        tool_name: "exec_command",
        tool_input: { cmd: "blocked" },
        timestamp: "2026-08-19T10:00:01.000Z",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "The tool did not run.",
        timestamp: "2026-08-19T10:00:02.000Z",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent[0].tools[0]).toMatchObject({
      resultMissing: true,
    });
    expect(sent[0].tools[0].endedAt).toBeUndefined();
    expect(sent[0].tools[0].error).toBeUndefined();
  });

  it("preserves a prior turn when its asynchronous completion follows the next prompt", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "interrupted-turn",
        prompt: "This turn is interrupted",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "next-turn",
        prompt: "Continue",
      },
      { dataDir },
    );

    await expect(
      readTurn(dataDir, "session-1", "interrupted-turn"),
    ).resolves.toMatchObject({ status: "open" });
    await expect(
      readTurn(dataDir, "session-1", "next-turn"),
    ).resolves.toMatchObject({ status: "open", prompt: "Continue" });

    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "interrupted-turn",
        last_assistant_message: "The first response.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );
    await handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "next-turn",
        last_assistant_message: "The next response.",
      },
      { dataDir, sendTrace: async ({ turn }) => void sent.push(turn) },
    );

    expect(sent.map((turn) => turn.turnId)).toEqual([
      "interrupted-turn",
      "next-turn",
    ]);
  });

  it("removes only open turns older than the retention window", async () => {
    const dataDir = await temporaryDataDir();
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "expired-turn",
        prompt: "This turn never completed",
        timestamp: "2026-08-17T09:00:00.000Z",
      },
      { dataDir },
    );
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "current-turn",
        prompt: "Continue",
        timestamp: "2026-08-19T10:00:00.000Z",
      },
      { dataDir },
    );

    await expect(
      readTurn(dataDir, "session-1", "expired-turn"),
    ).resolves.toBeNull();
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
        type: "agent-turn-complete",
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

  it("scans transcripts outside the session lock and retries a changed turn", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    let releaseScan: (() => void) | undefined;
    let markScanStarted: (() => void) | undefined;
    const scanStarted = new Promise<void>((resolve) => {
      markScanStarted = resolve;
    });
    const scanReleased = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    let scans = 0;
    await handleCodexHook(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-1",
        turn_id: "turn-1",
        prompt: "inspect slowly",
      },
      { dataDir },
    );

    const completion = handleCodexHook(
      {
        type: "agent-turn-complete",
        session_id: "session-1",
        turn_id: "turn-1",
        last_assistant_message: "done",
      },
      {
        dataDir,
        reconcileTranscript: async (turn) => {
          scans += 1;
          if (scans === 1) {
            markScanStarted?.();
            await scanReleased;
          }
          return turn;
        },
        sendTrace: async ({ turn }) => void sent.push(turn),
      },
    );
    await scanStarted;

    await handleCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        turn_id: "turn-1",
        tool_use_id: "late-tool",
        tool_name: "exec_command",
        tool_input: { cmd: "pwd" },
      },
      { dataDir },
    );
    releaseScan?.();
    await completion;

    expect(scans).toBe(2);
    expect(sent[0].tools).toEqual([
      expect.objectContaining({ toolUseId: "late-tool" }),
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
