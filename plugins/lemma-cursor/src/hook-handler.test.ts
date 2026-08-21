import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompletedCodingAgentTurn } from "../../../packages/ts/tracing/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  flushPendingTurns,
  handleCursorHook,
  sanitizeCapturedValue,
} from "./hook-handler.js";
import { listPendingTurns, writeCredentials } from "./storage.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(withCredentials = true): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lemma-cursor-hook-test-"));
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

async function writeTranscript(
  dataDir: string,
  entries: unknown[],
): Promise<string> {
  const path = join(dataDir, "transcript.jsonl");
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Cursor hook turn assembly", () => {
  it("sends one complete redacted trace per generation", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];

    await handleCursorHook(
      {
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        prompt: "Inspect the repository",
        model: "claude-sonnet-4-6-thinking",
        model_id: "claude-sonnet-4-6",
        model_params: [{ id: "thinking", value: "true" }],
        cursor_version: "3.16.29",
        workspace_roots: ["/workspace"],
        transcript_path: "/state/transcript.jsonl",
        timestamp: "2026-08-21T00:00:00.000Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "preToolUse",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        tool_use_id: "tool-1",
        tool_name: "Shell",
        tool_input: {
          command: "curl -H 'Authorization: Bearer private-token' example.test",
          api_key: "private-api-key",
        },
        cwd: "/workspace",
        timestamp: "2026-08-21T00:00:01.000Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "postToolUse",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        tool_use_id: "tool-1",
        tool_name: "Shell",
        tool_input: { command: "curl example.test" },
        tool_output: JSON.stringify({
          exitCode: 0,
          stdout: "access_token=private-output-token",
        }),
        duration: 1000,
        timestamp: "2026-08-21T00:00:02.000Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "afterAgentResponse",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        text: "I found the package manifest.",
        timestamp: "2026-08-21T00:00:03.000Z",
      },
      { dataDir },
    );
    const result = await handleCursorHook(
      {
        hook_event_name: "stop",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        status: "completed",
        timestamp: "2026-08-21T00:00:04.000Z",
      },
      { dataDir },
    );

    expect(result.status).toBe("queued");
    expect(
      await flushPendingTurns({
        dataDir,
        sendTrace: async ({ turn }) => {
          sent.push(turn);
        },
      }),
    ).toBe(1);
    expect(sent[0]).toMatchObject({
      harness: "cursor",
      sessionId: "conversation-1",
      turnId: "generation-1",
      generationId: "generation-1",
      prompt: "Inspect the repository",
      response: "I found the package manifest.",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      metadata: {
        "lemma.harness.cursor_version": "3.16.29",
        "lemma.harness.workspace_roots": ["/workspace"],
        "lemma.harness.transcript_path": "/state/transcript.jsonl",
        "lemma.harness.cursor_model_params": [
          { id: "thinking", value: "true" },
        ],
      },
    });
    const serialized = JSON.stringify(sent[0]);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private-api-key");
    expect(serialized).not.toContain("private-output-token");
    expect(sent[0]?.tools[0]).toMatchObject({
      toolUseId: "tool-1",
      toolName: "Shell",
      output: { exitCode: 0, stdout: "access_token=[REDACTED]" },
      startedAt: "2026-08-21T00:00:01.000Z",
      endedAt: "2026-08-21T00:00:02.000Z",
    });
    expect(await listPendingTurns(dataDir)).toEqual([]);
  });

  it("derives a missing tool start from Cursor duration", async () => {
    const dataDir = await temporaryDataDir();
    const sent: CompletedCodingAgentTurn[] = [];
    await handleCursorHook(
      {
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        prompt: "Run tests",
        timestamp: "2026-08-21T00:00:00.000Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "postToolUseFailure",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        tool_use_id: "tool-1",
        tool_name: "Shell",
        tool_input: { command: "pnpm test" },
        error_message: "Process exited with code 1",
        failure_type: "error",
        duration: 1500,
        timestamp: "2026-08-21T00:00:02.500Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "afterAgentResponse",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        text: "Tests failed.",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "stop",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
      },
      { dataDir },
    );
    await flushPendingTurns({
      dataDir,
      sendTrace: async ({ turn }) => {
        sent.push(turn);
      },
    });
    expect(sent[0]?.tools[0]).toMatchObject({
      error: "Process exited with code 1",
      startedAt: "2026-08-21T00:00:01.000Z",
      endedAt: "2026-08-21T00:00:02.500Z",
    });
  });

  it("reconstructs a scripted CLI turn with tools at sessionEnd", async () => {
    const dataDir = await temporaryDataDir();
    const transcriptPath = await writeTranscript(dataDir, [
      {
        role: "user",
        message: {
          content: [
            {
              type: "text",
              text: "<timestamp>now</timestamp>\n<user_query>\nInspect secret=private-value\n</user_query>",
            },
          ],
        },
      },
      {
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "I will inspect it." },
            { type: "tool_use", name: "ReadFile", input: { path: "README.md" } },
          ],
        },
      },
      {
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "Finished with Bearer private-token" },
            { type: "text", text: "\n\n**Specifying output format details**" },
          ],
        },
      },
      { type: "turn_ended", status: "success" },
    ]);

    await handleCursorHook(
      {
        hook_event_name: "preToolUse",
        conversation_id: "scripted-1",
        generation_id: "scripted-1",
        tool_use_id: "tool-1",
        tool_name: "ReadFile",
        tool_input: { path: "README.md" },
        timestamp: "2026-08-21T01:00:00.000Z",
      },
      { dataDir },
    );
    await handleCursorHook(
      {
        hook_event_name: "postToolUse",
        conversation_id: "scripted-1",
        generation_id: "scripted-1",
        tool_use_id: "tool-1",
        tool_name: "ReadFile",
        tool_output: "first sentence",
        timestamp: "2026-08-21T01:00:01.000Z",
      },
      { dataDir },
    );
    const result = await handleCursorHook(
      {
        hook_event_name: "sessionEnd",
        conversation_id: "scripted-1",
        generation_id: "scripted-1",
        transcript_path: transcriptPath,
        model: "claude-sonnet-4-6",
        cwd: "/workspace",
        timestamp: "2026-08-21T01:00:02.000Z",
      },
      { dataDir },
    );

    expect(result.status).toBe("queued");
    const sent: CompletedCodingAgentTurn[] = [];
    expect(
      await flushPendingTurns({
        dataDir,
        sendTrace: async ({ turn }) => {
          sent.push(turn);
        },
      }),
    ).toBe(1);
    expect(sent[0]).toMatchObject({
      sessionId: "scripted-1",
      turnId: "scripted-1",
      prompt: "Inspect secret=[REDACTED]",
      response: "Finished with Bearer [REDACTED]",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      metadata: {
        "lemma.harness.cwd": "/workspace",
        "lemma.harness.transcript_path": transcriptPath,
      },
    });
    expect(sent[0]?.tools[0]).toMatchObject({
      toolUseId: "tool-1",
      toolName: "ReadFile",
      output: "first sentence",
    });
  });

  it("reconstructs a scripted CLI turn without tools", async () => {
    const dataDir = await temporaryDataDir();
    const transcriptPath = await writeTranscript(dataDir, [
      {
        role: "user",
        message: {
          content: [{ type: "text", text: "<user_query>Answer briefly</user_query>" }],
        },
      },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "Done.\n\n**Next steps**" }] },
      },
    ]);
    await handleCursorHook(
      {
        hook_event_name: "sessionEnd",
        conversation_id: "scripted-2",
        generation_id: "scripted-2",
        transcript_path: transcriptPath,
        timestamp: "2026-08-21T02:00:00.000Z",
      },
      { dataDir },
    );
    const sent: CompletedCodingAgentTurn[] = [];
    await flushPendingTurns({
      dataDir,
      sendTrace: async ({ turn }) => {
        sent.push(turn);
      },
    });
    expect(sent[0]).toMatchObject({
      prompt: "Answer briefly",
      response: "Done.\n\n**Next steps**",
      tools: [],
    });
  });

  it("ignores missing and incomplete scripted transcripts", async () => {
    const dataDir = await temporaryDataDir();
    const warnings: string[] = [];
    const missing = await handleCursorHook(
      {
        hook_event_name: "sessionEnd",
        conversation_id: "scripted-3",
        generation_id: "scripted-3",
        transcript_path: join(dataDir, "missing.jsonl"),
      },
      { dataDir, warn: (message) => warnings.push(message) },
    );
    const transcriptPath = await writeTranscript(dataDir, [
      { role: "assistant", message: { content: [{ type: "text", text: "Only response" }] } },
      "not an object",
    ]);
    const incomplete = await handleCursorHook(
      {
        hook_event_name: "sessionEnd",
        conversation_id: "scripted-4",
        generation_id: "scripted-4",
        transcript_path: transcriptPath,
      },
      { dataDir, warn: (message) => warnings.push(message) },
    );
    expect(missing.status).toBe("ignored");
    expect(incomplete.status).toBe("ignored");
    expect(await listPendingTurns(dataDir)).toEqual([]);
    expect(warnings.join("\n")).toContain("could not read");
    expect(warnings.join("\n")).toContain("could not reconstruct");
  });

  it("deduplicates repeated scripted sessionEnd events", async () => {
    const dataDir = await temporaryDataDir();
    const transcriptPath = await writeTranscript(dataDir, [
      {
        role: "user",
        message: { content: [{ type: "text", text: "<user_query>Hello</user_query>" }] },
      },
      {
        role: "assistant",
        message: { content: [{ type: "text", text: "Hi" }] },
      },
    ]);
    const event = {
      hook_event_name: "sessionEnd",
      conversation_id: "scripted-5",
      generation_id: "scripted-5",
      transcript_path: transcriptPath,
    };
    await handleCursorHook(event, { dataDir });
    await handleCursorHook(event, { dataDir });
    expect(await listPendingTurns(dataDir)).toHaveLength(1);
  });

  it("retains failed delivery for retry and deduplicates stop", async () => {
    const dataDir = await temporaryDataDir();
    const prompt = {
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "conversation-1",
      generation_id: "generation-1",
      prompt: "Hello",
    };
    const stop = {
      hook_event_name: "stop",
      conversation_id: "conversation-1",
      generation_id: "generation-1",
    };
    await handleCursorHook(prompt, { dataDir });
    await handleCursorHook(stop, { dataDir });
    const [first] = await listPendingTurns(dataDir);
    await handleCursorHook(stop, { dataDir });
    const [second] = await listPendingTurns(dataDir);
    expect(second.deliveryId).toBe(first.deliveryId);

    expect(
      await flushPendingTurns({
        dataDir,
        sendTrace: async () => {
          throw new Error("host unavailable");
        },
      }),
    ).toBe(0);
    expect(await listPendingTurns(dataDir)).toHaveLength(1);
    expect(
      await flushPendingTurns({ dataDir, sendTrace: async () => undefined }),
    ).toBe(1);
  });

  it("fails open when setup is incomplete", async () => {
    const dataDir = await temporaryDataDir(false);
    const warnings: string[] = [];
    await handleCursorHook(
      {
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
        prompt: "Hello",
      },
      { dataDir },
    );
    const result = await handleCursorHook(
      {
        hook_event_name: "stop",
        conversation_id: "conversation-1",
        generation_id: "generation-1",
      },
      { dataDir, warn: (message) => warnings.push(message) },
    );
    expect(result.status).toBe("ignored");
    expect(warnings.join("\n")).toContain("setup is incomplete");
  });

  it("redacts nested sensitive values", () => {
    expect(
      sanitizeCapturedValue({
        headers: { authorization: "Bearer private" },
        nested: [{ secret: "private" }],
      }),
    ).toEqual({
      headers: { authorization: "[REDACTED]" },
      nested: [{ secret: "[REDACTED]" }],
    });
  });
});
