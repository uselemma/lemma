import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableDebugMode } from "./debug-mode";
import {
  LemmaMastraExporter,
  mastra,
  type MastraExportedSpan,
  type MastraTracingEvent,
} from "./mastra";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

function span(partial: Partial<MastraExportedSpan> & Pick<MastraExportedSpan, "id" | "name" | "type">): MastraExportedSpan {
  return {
    traceId: "trace_mastra_1",
    isRootSpan: false,
    isEvent: false,
    startTime: "2026-06-29T10:00:00.000Z",
    endTime: "2026-06-29T10:00:00.100Z",
    ...partial,
  };
}

async function emit(
  exporter: LemmaMastraExporter,
  type: MastraTracingEvent["type"],
  exportedSpan: MastraExportedSpan,
) {
  await exporter.exportTracingEvent({ type, exportedSpan });
}

describe("mastra / LemmaMastraExporter", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
  });

  it("records deep nesting, full-message generations, and tools under one trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      agentName: "support-agent",
    });

    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "where is my order?" },
    ];

    await emit(
      exporter,
      "span_ended",
      span({
        id: "gen_1",
        name: "model-generation",
        type: "model_generation",
        parentSpanId: "root_1",
        startTime: "2026-06-29T10:00:00.000Z",
        endTime: "2026-06-29T10:00:00.200Z",
        input: messages,
        output: { role: "assistant", content: "It arrives Friday." },
        attributes: {
          model: "gpt-4o",
          provider: "openai",
          parameters: { temperature: 0.2 },
        },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "step_1",
        name: "model-step",
        type: "model_step",
        parentSpanId: "gen_1",
        startTime: "2026-06-29T10:00:00.010Z",
        endTime: "2026-06-29T10:00:00.080Z",
        input: messages,
        output: { role: "assistant", content: "calling tool" },
        attributes: { model: "gpt-4o", provider: "openai" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "tool_1",
        name: "search_docs",
        type: "tool_call",
        parentSpanId: "gen_1",
        startTime: "2026-06-29T10:00:00.090Z",
        endTime: "2026-06-29T10:00:00.150Z",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
        attributes: { toolId: "search_docs" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_1",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        startTime: "2026-06-29T10:00:00.000Z",
        endTime: "2026-06-29T10:00:00.220Z",
        input: "where is my order?",
        output: "It arrives Friday.",
        metadata: { threadId: "thread-1", userId: "user-1" },
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      id: "trace_mastra_1",
      name: "support-agent",
      input: "where is my order?",
      output: "It arrives Friday.",
      thread_id: "thread-1",
      user_id: "user-1",
      duration_ms: 220,
    });
    expect(body.trace.spans).toMatchObject([
      {
        id: "gen_1",
        name: "model-generation",
        type: "generation",
        input: messages,
        output: { role: "assistant", content: "It arrives Friday." },
        model: "gpt-4o",
        attributes: {
          "llm.provider": "openai",
          "llm.input_messages.0.message.role": "system",
          "llm.input_messages.1.message.role": "user",
          "mastra.span_type": "model_generation",
        },
      },
      {
        id: "step_1",
        parent_id: "gen_1",
        type: "generation",
        name: "model-step",
      },
      {
        id: "tool_1",
        parent_id: "gen_1",
        type: "tool",
        tool_name: "search_docs",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
      },
    ]);
    expect(
      Date.parse(body.trace.spans[0].ended_at) -
        Date.parse(body.trace.spans[0].started_at),
    ).toBe(200);
    expect(
      Date.parse(body.trace.spans[2].ended_at) -
        Date.parse(body.trace.spans[2].started_at),
    ).toBe(60);
  });

  it("records root and child errors without inventing outputs", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = new LemmaMastraExporter({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "tool_err",
        name: "lookup",
        type: "tool_call",
        parentSpanId: "root_err",
        input: { id: "1843" },
        errorInfo: { message: "order not found" },
        attributes: { toolId: "lookup" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_err",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "find my order",
        errorInfo: { message: "agent failed" },
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "agent failed",
      input: "find my order",
    });
    expect(body.trace).not.toHaveProperty("output");
    expect(body.trace.spans[0]).toMatchObject({
      type: "tool",
      status: "ERROR",
      error: "order not found",
      input: { id: "1843" },
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("attaches orphan children directly under the trace root", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "orphan_tool",
        name: "search",
        type: "tool_call",
        // Parent was an internal span Mastra never exported.
        parentSpanId: "hidden_internal",
        input: { q: "x" },
        output: { ok: true },
        attributes: { toolId: "search" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_orphan",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
        output: "hello",
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      id: "orphan_tool",
      type: "tool",
    });
    expect(body.trace.spans[0].parent_id).toBeUndefined();
  });

  it("resolves threadId and userId from requestContext resourceId fallback", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_ctx",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
        output: "hello",
        requestContext: {
          threadId: "mem-thread",
          resourceId: "resource-user",
        },
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      thread_id: "mem-thread",
      user_id: "resource-user",
    });
  });

  it("omits payloads when recordInputs/recordOutputs are false", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      recordInputs: false,
      recordOutputs: false,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "gen_priv",
        name: "model-generation",
        type: "model_generation",
        parentSpanId: "root_priv",
        input: [{ role: "user", content: "secret" }],
        output: { role: "assistant", content: "secret-out" },
        attributes: { model: "gpt-4o", provider: "openai" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_priv",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "secret",
        output: "secret-out",
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).not.toHaveProperty("input");
    expect(body.trace).not.toHaveProperty("output");
    expect(body.trace.spans[0]).not.toHaveProperty("input");
    expect(body.trace.spans[0]).not.toHaveProperty("output");
    expect(body.trace.spans[0].model).toBe("gpt-4o");
  });

  it("buffers event spans on span_started and ignores span_updated", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_started",
      span({
        id: "event_1",
        name: "chunk",
        type: "model_chunk",
        parentSpanId: "root_event",
        isEvent: true,
        endTime: undefined,
        input: { text: "hi" },
      }),
    );
    await emit(
      exporter,
      "span_updated",
      span({
        id: "root_event",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_event",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
        output: "hello",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toHaveLength(1);
    expect(body.trace.spans[0]).toMatchObject({
      id: "event_1",
      type: "span",
      name: "chunk",
    });
  });

  it("dedupes event spans that arrive on both span_started and span_ended", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_started",
      span({
        id: "event_dup",
        name: "chunk",
        type: "model_chunk",
        parentSpanId: "root_dup",
        isEvent: true,
        endTime: undefined,
        output: { text: "partial" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "event_dup",
        name: "chunk",
        type: "model_chunk",
        parentSpanId: "root_dup",
        isEvent: true,
        output: { text: "final" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_dup",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
        output: "hello",
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toHaveLength(1);
    expect(body.trace.spans[0]).toMatchObject({
      id: "event_dup",
      output: { text: "final" },
    });
  });

  it("marks soft MCP tool errors as ERROR without inventing output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "mcp_1",
        name: "lookup",
        type: "mcp_tool_call",
        parentSpanId: "root_mcp",
        input: { id: "1843" },
        output: {
          isError: true,
          content: [{ type: "text", text: "order not found" }],
        },
        attributes: { toolId: "lookup" },
      }),
    );
    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_mcp",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "find my order",
        output: "failed",
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "tool",
      status: "ERROR",
      error: "order not found",
      input: { id: "1843" },
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("extracts the latest user message as root input and preserves Mastra wall times", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await emit(
      exporter,
      "span_ended",
      span({
        id: "root_messages",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        startTime: "2026-06-29T10:00:00.000Z",
        endTime: "2026-06-29T10:00:02.500Z",
        input: {
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "first turn" },
            { role: "assistant", content: "ok" },
            { role: "user", content: "Where is my order #1843?" },
          ],
        },
        output: "It arrives Friday.",
      }),
    );

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "Where is my order #1843?",
      output: "It arrives Friday.",
      duration_ms: 2500,
      started_at: "2026-06-29T10:00:00.000Z",
      ended_at: "2026-06-29T10:00:02.500Z",
    });
  });

  it("awaits outstanding deliveries on flush/shutdown", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const exporter = mastra({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    const deliver = emit(
      exporter,
      "span_ended",
      span({
        id: "root_flush",
        name: "agent-run",
        type: "agent_run",
        isRootSpan: true,
        input: "hi",
        output: "hello",
      }),
    );

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const flushPromise = exporter.flush();
    resolveFetch?.(new Response("{}", { status: 201 }));
    await deliver;
    await flushPromise;
    await exporter.shutdown();
  });
});
