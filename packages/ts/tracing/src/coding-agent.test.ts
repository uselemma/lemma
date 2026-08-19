import { describe, expect, it, vi } from "vitest";

import { Lemma } from "./client";
import {
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
} from "./coding-agent";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as {
    trace: {
      id: string;
      thread_id: string;
      input: unknown;
      output: unknown;
      metadata: Record<string, unknown>;
      spans: Array<Record<string, unknown>>;
    };
  };
}

describe("coding-agent turn assembly", () => {
  it("builds two complete traces linked by one harness session", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "scoped-key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test",
      fetch: fetchMock as typeof fetch,
    });

    const first = completeCodingAgentTurn(
      recordCodingAgentToolResult(
        recordCodingAgentToolStart(
          startCodingAgentTurn({
            harness: "codex",
            sessionId: "session-1",
            turnId: "turn-1",
            traceId: "trace-1",
            generationId: "generation-1",
            prompt: "Inspect the repository",
            startedAt: "2026-08-19T10:00:00.000Z",
            model: "gpt-5",
          }),
          {
            toolUseId: "tool-1",
            toolName: "exec_command",
            input: { cmd: "rg --files" },
            startedAt: "2026-08-19T10:00:01.000Z",
          },
        ),
        {
          toolUseId: "tool-1",
          toolName: "exec_command",
          input: { cmd: "rg --files" },
          output: { output: "package.json" },
          endedAt: "2026-08-19T10:00:02.000Z",
        },
      ),
      {
        response: "I found the package manifest.",
        endedAt: "2026-08-19T10:00:03.000Z",
      },
    );
    const second = completeCodingAgentTurn(
      startCodingAgentTurn({
        harness: "codex",
        sessionId: "session-1",
        turnId: "turn-2",
        traceId: "trace-2",
        generationId: "generation-2",
        prompt: "Now explain it",
        startedAt: "2026-08-19T10:01:00.000Z",
      }),
      {
        response: "It is a TypeScript package.",
        endedAt: "2026-08-19T10:01:01.000Z",
      },
    );

    for (const turn of [first, second]) {
      const assembled = codingAgentTurnTrace(turn);
      await lemma.ingest(assembled.context, {
        startedAt: new Date(assembled.startedAt),
        endedAt: new Date(assembled.endedAt),
      });
    }

    const bodies = fetchMock.mock.calls.map(jsonBody);
    expect(bodies.map((body) => body.trace.id)).toEqual(["trace-1", "trace-2"]);
    expect(bodies.map((body) => body.trace.thread_id)).toEqual([
      "session-1",
      "session-1",
    ]);
    expect(bodies[0].trace).toMatchObject({
      input: "Inspect the repository",
      output: "I found the package manifest.",
      metadata: {
        "lemma.harness.id": "codex",
        "lemma.harness.session_id": "session-1",
        "lemma.harness.turn_id": "turn-1",
      },
    });
    expect(bodies[0].trace.spans).toEqual([
      expect.objectContaining({
        id: "tool-1",
        name: "exec_command",
        type: "tool",
        input: { cmd: "rg --files" },
        output: { output: "package.json" },
        tool_name: "exec_command",
        started_at: "2026-08-19T10:00:01.000Z",
        ended_at: "2026-08-19T10:00:02.000Z",
      }),
      expect.objectContaining({
        id: "generation-1",
        name: "codex response",
        type: "generation",
        model: "gpt-5",
        input: "Inspect the repository",
        output: "I found the package manifest.",
      }),
    ]);
  });

  it("finalizes on the assistant response without a session-end event", () => {
    const completed = completeCodingAgentTurn(
      startCodingAgentTurn({
        harness: "codex",
        sessionId: "still-open",
        turnId: "turn-1",
        prompt: "Keep this chat open",
        startedAt: "2026-08-19T10:00:00.000Z",
      }),
      {
        response: "The turn is still complete.",
        endedAt: "2026-08-19T10:00:01.000Z",
      },
    );

    expect(completed.status).toBe("completed");
    expect(codingAgentTurnTrace(completed).endedAt).toBe(
      "2026-08-19T10:00:01.000Z",
    );
  });

  it("makes duplicate completion idempotent and rejects late tools", () => {
    const completed = completeCodingAgentTurn(
      startCodingAgentTurn({
        harness: "codex",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "hello",
        startedAt: "2026-08-19T10:00:00.000Z",
      }),
      {
        response: "first",
        endedAt: "2026-08-19T10:00:01.000Z",
      },
    );

    expect(
      completeCodingAgentTurn(completed, {
        response: "ignored duplicate",
        endedAt: "2026-08-19T10:00:02.000Z",
      }),
    ).toBe(completed);
    expect(() =>
      recordCodingAgentToolStart(completed, {
        toolUseId: "late",
        toolName: "exec_command",
        input: {},
        startedAt: "2026-08-19T10:00:02.000Z",
      }),
    ).toThrow("already completed");
  });

  it("records a post-tool event even when the pre-tool event was missed", () => {
    const open = recordCodingAgentToolResult(
      startCodingAgentTurn({
        harness: "codex",
        sessionId: "session-1",
        turnId: "turn-1",
        prompt: "hello",
        startedAt: "2026-08-19T10:00:00.000Z",
      }),
      {
        toolUseId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
        error: "permission denied",
        endedAt: "2026-08-19T10:00:01.000Z",
      },
    );

    expect(open.tools).toEqual([
      expect.objectContaining({
        toolUseId: "tool-1",
        toolName: "read_file",
        input: { path: "README.md" },
        error: "permission denied",
        endedAt: "2026-08-19T10:00:01.000Z",
      }),
    ]);
    expect(open.tools[0].startedAt).toBeUndefined();
  });

  it("closes tools with missing results as errors when the turn completes", async () => {
    const completed = completeCodingAgentTurn(
      recordCodingAgentToolStart(
        startCodingAgentTurn({
          harness: "codex",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "run a tool",
          startedAt: "2026-08-19T10:00:00.000Z",
        }),
        {
          toolUseId: "tool-1",
          toolName: "exec_command",
          startedAt: "2026-08-19T10:00:01.000Z",
        },
      ),
      {
        response: "The tool result was lost.",
        endedAt: "2026-08-19T10:00:02.000Z",
      },
    );
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "scoped-key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test",
      fetch: fetchMock as typeof fetch,
    });

    const assembled = codingAgentTurnTrace(completed);
    await lemma.ingest(assembled.context, {
      startedAt: new Date(assembled.startedAt),
      endedAt: new Date(assembled.endedAt),
    });

    expect(completed.tools[0]).toMatchObject({
      error: "Coding agent turn completed without a tool result",
      endedAt: "2026-08-19T10:00:02.000Z",
    });
    expect(jsonBody(fetchMock.mock.calls[0]).trace.spans[0]).toMatchObject({
      status: "ERROR",
      error: "Coding agent turn completed without a tool result",
      ended_at: "2026-08-19T10:00:02.000Z",
    });
  });

  it("treats a null tool error as success and marks missing starts", async () => {
    const completed = completeCodingAgentTurn(
      recordCodingAgentToolResult(
        startCodingAgentTurn({
          harness: "codex",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "read a file",
          startedAt: "2026-08-19T10:00:00.000Z",
        }),
        {
          toolUseId: "tool-1",
          toolName: "read_file",
          error: null,
          endedAt: "2026-08-19T10:00:01.000Z",
        },
      ),
      {
        response: "Done.",
        endedAt: "2026-08-19T10:00:02.000Z",
      },
    );
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "scoped-key",
      projectId: "10000000-0000-0000-0000-000000000001",
      baseUrl: "https://api.example.test",
      fetch: fetchMock as typeof fetch,
    });

    const assembled = codingAgentTurnTrace(completed);
    await lemma.ingest(assembled.context, {
      startedAt: new Date(assembled.startedAt),
      endedAt: new Date(assembled.endedAt),
    });

    expect(jsonBody(fetchMock.mock.calls[0]).trace.spans[0]).toMatchObject({
      status: "OK",
      started_at: "2026-08-19T10:00:00.000Z",
      ended_at: "2026-08-19T10:00:01.000Z",
      metadata: {
        tool_use_id: "tool-1",
        start_time_missing: true,
      },
    });
  });
});
