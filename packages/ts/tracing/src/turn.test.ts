import { describe, expect, it, vi } from "vitest";

import { Lemma, TraceContext } from "./client";
import {
  applyTurnJournal,
  assembleTurn,
  attachTurn,
  parseTurnContextToken,
  startTurn,
} from "./turn";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as {
    trace: {
      id: string;
      name: string;
      thread_id?: string;
      user_id?: string;
      input?: unknown;
      output?: unknown;
      status?: string;
      error?: string | null;
      spans: Array<{
        id?: string;
        parent_id?: string | null;
        name: string;
        type: string;
        input?: unknown;
        output?: unknown;
        status?: string;
        error?: string | null;
        started_at?: string | null;
        ended_at?: string | null;
        model?: string;
        attributes?: Record<string, unknown>;
      }>;
    };
  };
}

const PROJECT_ID = "10000000-0000-0000-0000-000000000001";

function hostClient(fetchMock: ReturnType<typeof vi.fn>) {
  return new Lemma({
    apiKey: "key",
    projectId: PROJECT_ID,
    baseUrl: "https://api.example.test",
    fetch: fetchMock as typeof fetch,
  });
}

describe("cross-process turn journal", () => {
  it("stitches host and child into one ingest payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);

    const turn = startTurn(host, {
      id: "trace-1",
      name: "agent-turn",
      input: "fix the bug",
      threadId: "thread-1",
      userId: "user-1",
      startedAt: "2026-09-03T00:00:00.000Z",
    });
    const sandbox = turn.startSpan({
      id: "sandbox-1",
      name: "e2b-sandbox",
      startedAt: "2026-09-03T00:00:00.500Z",
    });
    const tokenJson = JSON.stringify(
      turn.export({ parentSpanId: sandbox.id }),
    );

    const local = attachTurn(tokenJson);
    local.recordTool({
      id: "tool-1",
      name: "search",
      input: { q: "bug" },
      output: { hits: 1 },
      startedAt: "2026-09-03T00:00:01.000Z",
      endedAt: "2026-09-03T00:00:02.000Z",
    });
    const gen = local.startGeneration({
      id: "gen-1",
      name: "answer",
      model: "gpt-4o",
      startedAt: "2026-09-03T00:00:02.000Z",
    });
    gen.end({
      output: "patched",
      endedAt: "2026-09-03T00:00:03.000Z",
    });
    const journalJson = JSON.stringify(local.records());

    expect(fetchMock).not.toHaveBeenCalled();

    turn.apply(journalJson);
    sandbox.end({
      output: { ok: true },
      endedAt: "2026-09-03T00:00:03.500Z",
    });
    await turn.end({
      output: "patched",
      endedAt: "2026-09-03T00:00:04.000Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      id: "trace-1",
      name: "agent-turn",
      input: "fix the bug",
      output: "patched",
      thread_id: "thread-1",
      user_id: "user-1",
    });
    expect(body.trace.spans).toEqual([
      expect.objectContaining({
        id: "sandbox-1",
        name: "e2b-sandbox",
        type: "span",
        output: { ok: true },
      }),
      expect.objectContaining({
        id: "tool-1",
        name: "search",
        type: "tool",
        parent_id: "sandbox-1",
        input: { q: "bug" },
        output: { hits: 1 },
      }),
      expect.objectContaining({
        id: "gen-1",
        name: "answer",
        type: "generation",
        parent_id: "sandbox-1",
        model: "gpt-4o",
        output: "patched",
      }),
    ]);
    expect(body.trace.spans[0].parent_id ?? null).toBeNull();
  });

  it("does not call Lemma from attachTurn", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const local = attachTurn({
      version: 1,
      traceId: "trace-1",
      parentSpanId: "sandbox-1",
      startedAt: "2026-09-03T00:00:00.000Z",
    });
    local.recordSpan({ name: "work", output: "done" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(local.records().records).toHaveLength(1);
    expect(local.records().token.traceId).toBe("trace-1");
  });

  it("re-applying the same journal does not duplicate spans", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);
    const turn = startTurn(host, {
      id: "trace-1",
      name: "agent-turn",
      startedAt: "2026-09-03T00:00:00.000Z",
    });
    const sandbox = turn.startSpan({ id: "sandbox-1", name: "e2b-sandbox" });
    const local = attachTurn(turn.export({ parentSpanId: sandbox.id }));
    local.recordTool({
      id: "tool-1",
      name: "search",
      output: { hits: 1 },
    });
    const journal = local.records();
    turn.apply(journal);
    turn.apply(journal);
    turn.apply(JSON.stringify(journal));
    sandbox.end();
    await turn.end({ output: "ok" });

    const spans = jsonBody(fetchMock.mock.calls[0]).trace.spans;
    expect(spans.filter((span) => span.id === "tool-1")).toHaveLength(1);
    expect(spans.filter((span) => span.id === "sandbox-1")).toHaveLength(1);
  });

  it("retried assemble+ingest keeps stable span ids", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);
    const token = {
      version: 1 as const,
      traceId: "trace-1",
      parentSpanId: "sandbox-1",
      threadId: "thread-1",
      startedAt: "2026-09-03T00:00:00.000Z",
      name: "agent-turn",
    };
    const local = attachTurn(token);
    local.recordTool({ id: "tool-1", name: "search", output: { hits: 1 } });
    const journal = local.records();

    for (let i = 0; i < 2; i += 1) {
      const assembled = assembleTurn(token, journal, {
        name: "agent-turn",
        input: "fix",
        output: "done",
      });
      assembled.context.recordSpan({
        id: "sandbox-1",
        name: "e2b-sandbox",
        startedAt: token.startedAt,
        endedAt: "2026-09-03T00:00:04.000Z",
      });
      applyTurnJournal(assembled.context, journal);
      await host.ingest(assembled.context, {
        startedAt: assembled.startedAt,
        endedAt: new Date("2026-09-03T00:00:04.000Z"),
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = jsonBody(fetchMock.mock.calls[0]).trace.spans.map(
      (span) => span.id,
    );
    const second = jsonBody(fetchMock.mock.calls[1]).trace.spans.map(
      (span) => span.id,
    );
    expect(first).toEqual(second);
    expect(first).toEqual(expect.arrayContaining(["sandbox-1", "tool-1"]));
  });

  it("allows incomplete tools and host ERROR when the child exits uncleanly", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);
    const turn = startTurn(host, {
      id: "trace-1",
      name: "agent-turn",
      startedAt: "2026-09-03T00:00:00.000Z",
    });
    const sandbox = turn.startSpan({ id: "sandbox-1", name: "e2b-sandbox" });
    const local = attachTurn(turn.export({ parentSpanId: sandbox.id }));
    local.startTool({
      id: "tool-open",
      name: "edit_file",
      input: { path: "app.ts" },
      startedAt: "2026-09-03T00:00:01.000Z",
    });
    turn.apply(local.records());
    sandbox.end({
      status: "ERROR",
      error: "sandbox killed",
      endedAt: "2026-09-03T00:00:02.000Z",
    });
    turn.fail("sandbox exited uncleanly");
    await turn.end({ endedAt: "2026-09-03T00:00:02.000Z" });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "sandbox exited uncleanly",
    });
    expect(body.trace.spans).toEqual([
      expect.objectContaining({
        id: "sandbox-1",
        status: "ERROR",
        error: "sandbox killed",
      }),
      expect.objectContaining({
        id: "tool-open",
        type: "tool",
        parent_id: "sandbox-1",
      }),
    ]);
    expect(body.trace.spans[1].ended_at ?? null).toBeNull();
  });

  it("keeps turn.end() strict so ingest failures can be retried", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const host = hostClient(fetchMock);
    const turn = startTurn(host, { name: "agent-turn" });
    await expect(turn.end({ output: "ok" })).rejects.toThrow(
      "failed to ingest trace (503): nope",
    );
  });

  it("parses a versioned context token and rejects invalid ones", () => {
    const token = parseTurnContextToken({
      version: 1,
      traceId: "trace-1",
      startedAt: "2026-09-03T00:00:00.000Z",
      parentSpanId: "sandbox-1",
    });
    expect(token.traceId).toBe("trace-1");
    expect(() => parseTurnContextToken("{}")).toThrow("invalid turn context token");
    expect(() =>
      parseTurnContextToken({
        version: 2,
        traceId: "trace-1",
        startedAt: "2026-09-03T00:00:00.000Z",
      } as never),
    ).toThrow("invalid turn context token");
  });

  it("nests child start/end handles under the exported parent span", () => {
    const context = new TraceContext({ id: "trace-1", name: "agent-turn" });
    const local = attachTurn({
      version: 1,
      traceId: "trace-1",
      parentSpanId: "sandbox-1",
      startedAt: "2026-09-03T00:00:00.000Z",
    });
    const work = local.startSpan({
      id: "work-1",
      name: "sandbox-work",
      startedAt: "2026-09-03T00:00:01.000Z",
    });
    work
      .startTool({
        id: "tool-1",
        name: "search",
        startedAt: "2026-09-03T00:00:01.100Z",
      })
      .end({
        output: { hits: 1 },
        endedAt: "2026-09-03T00:00:01.200Z",
      });
    work.end({ endedAt: "2026-09-03T00:00:01.300Z" });
    applyTurnJournal(context, local.records());
    const payload = context.toPayload(
      PROJECT_ID,
      new Date("2026-09-03T00:00:00.000Z"),
      new Date("2026-09-03T00:00:02.000Z"),
    );
    expect(payload.trace.spans).toEqual([
      expect.objectContaining({
        id: "work-1",
        parent_id: "sandbox-1",
        type: "span",
      }),
      expect.objectContaining({
        id: "tool-1",
        parent_id: "work-1",
        type: "tool",
        output: { hits: 1 },
      }),
    ]);
  });

  it("startTurn is available as a standalone helper", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);
    const turn = startTurn(host, { name: "agent-turn", input: "hi" });
    await turn.end({ output: "ok" });
    expect(jsonBody(fetchMock.mock.calls[0]).trace).toMatchObject({
      name: "agent-turn",
      input: "hi",
      output: "ok",
    });
  });

  it("preserves LLM and tool journal fields on start/end apply", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const host = hostClient(fetchMock);
    const turn = startTurn(host, { id: "trace-1", name: "agent-turn" });
    turn.apply({
      version: 1,
      token: {
        version: 1,
        traceId: "trace-1",
        parentSpanId: "sandbox-1",
        startedAt: "2026-09-03T00:00:00.000Z",
      },
      records: [
        {
          op: "start",
          id: "gen-1",
          parentId: "sandbox-1",
          name: "answer",
          type: "generation",
          model: "gpt-4o",
          llmModelName: "gpt-4o-mini",
          llmSystem: "openai",
          llmPromptTemplate: "Say {x}",
          llmPromptTemplateVariables: { x: "hi" },
          llmPromptTemplateVersion: "1",
          startedAt: "2026-09-03T00:00:01.000Z",
        },
        {
          op: "end",
          id: "gen-1",
          input: "Say hi",
          inputMimeType: "text/plain",
          output: "hello",
          llmModelName: "gpt-4o-mini",
          endedAt: "2026-09-03T00:00:02.000Z",
        },
        {
          op: "start",
          id: "tool-1",
          parentId: "sandbox-1",
          name: "search",
          type: "tool",
          userFacingMessage: "Looking it up",
          startedAt: "2026-09-03T00:00:02.000Z",
        },
        {
          op: "end",
          id: "tool-1",
          output: { hits: 1 },
          userFacingMessage: "Looking it up",
          endedAt: "2026-09-03T00:00:03.000Z",
        },
      ],
    });
    await turn.end({ output: "ok" });
    const spans = jsonBody(fetchMock.mock.calls[0]).trace.spans;
    const byId = Object.fromEntries(spans.map((span) => [span.id, span]));
    expect(byId["gen-1"]).toMatchObject({
      input: "Say hi",
      output: "hello",
    });
    expect(byId["gen-1"]?.attributes).toMatchObject({
      "llm.model_name": "gpt-4o-mini",
      "llm.system": "openai",
      "llm.prompt_template.template": "Say {x}",
      "llm.prompt_template.version": "1",
      "input.mime_type": "text/plain",
    });
    expect(byId["tool-1"]?.attributes).toMatchObject({
      "lemma.tool.message": "Looking it up",
    });
  });
});
