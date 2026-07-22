import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disableDebugMode, enableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("openAIAgents", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
  });

  it("records OpenAI Agents generation and function spans under one trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_openai_1",
      name: "support-agent",
      groupId: "thread-1",
      metadata: { userId: "user-1" },
    });
    await processor.onSpanStart({
      traceId: "trace_openai_1",
      spanId: "span_generation_1",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        model: "gpt-4o",
        model_config: { temperature: 0.2 },
      },
      startedAt: "2026-06-29T10:00:00.000Z",
    });
    await processor.onSpanStart({
      traceId: "trace_openai_1",
      spanId: "span_tool_1",
      parentId: "span_generation_1",
      spanData: {
        type: "function",
        name: "search_docs",
        input: JSON.stringify({ query: "order" }),
      },
      startedAt: "2026-06-29T10:00:00.050Z",
    });
    await processor.onSpanEnd({
      traceId: "trace_openai_1",
      spanId: "span_tool_1",
      parentId: "span_generation_1",
      spanData: {
        type: "function",
        name: "search_docs",
        input: JSON.stringify({ query: "order" }),
        output: JSON.stringify([{ title: "Shipping" }]),
      },
      startedAt: "2026-06-29T10:00:00.050Z",
      endedAt: "2026-06-29T10:00:00.090Z",
    });
    await processor.onSpanEnd({
      traceId: "trace_openai_1",
      spanId: "span_generation_1",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: [{ role: "assistant", content: "It arrives Friday." }],
        model: "gpt-4o",
      },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: "2026-06-29T10:00:00.125Z",
    });
    await processor.onTraceEnd({
      traceId: "trace_openai_1",
      name: "support-agent",
      groupId: "thread-1",
      metadata: { userId: "user-1" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "where is my order?",
      output: "It arrives Friday.",
      thread_id: "thread-1",
      user_id: "user-1",
      duration_ms: 125,
      metadata: {
        userId: "user-1",
        openaiAgentsTraceId: "trace_openai_1",
        openaiAgentsGroupId: "thread-1",
      },
    });
    expect(body.trace.id).not.toBe("trace_openai_1");
    expect(body.trace.started_at).toBe("2026-06-29T10:00:00.000Z");
    expect(body.trace.ended_at).toBe("2026-06-29T10:00:00.125Z");
    expect(body.trace.spans).toMatchObject([
      {
        id: "span_generation_1",
        name: "openai-agents-generation",
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: "It arrives Friday.",
        model: "gpt-4o",
        duration_ms: 125,
        attributes: {
          "llm.provider": "openai",
          "llm.input_messages.0.message.role": "user",
          "llm.input_messages.0.message.content": "where is my order?",
          "openai.agents.trace_id": "trace_openai_1",
          "openai.agents.span_id": "span_generation_1",
          "openai.agents.span_type": "generation",
        },
      },
      {
        id: "span_tool_1",
        parent_id: "span_generation_1",
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
        tool_name: "search_docs",
        duration_ms: 40,
      },
    ]);
    expect(
      Date.parse(body.trace.spans[0].ended_at) -
        Date.parse(body.trace.spans[0].started_at),
    ).toBe(125);
    expect(
      Date.parse(body.trace.spans[1].ended_at) -
        Date.parse(body.trace.spans[1].started_at),
    ).toBe(40);
  });

  it("records function spans with isError output as error without output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_err",
      name: "support-agent",
    });
    await processor.onSpanStart({
      traceId: "trace_err",
      spanId: "span_tool",
      spanData: {
        type: "function",
        name: "pdf_server_pdf",
        input: JSON.stringify({ query: "YAT" }),
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_err",
      spanId: "span_tool",
      spanData: {
        type: "function",
        name: "pdf_server_pdf",
        input: JSON.stringify({ query: "YAT" }),
        output: JSON.stringify({
          content: [{ type: "text", text: "Internal error: Validation error" }],
          isError: true,
        }),
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_err",
      name: "support-agent",
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "pdf_server_pdf",
      type: "tool",
      status: "ERROR",
      error: "Internal error: Validation error",
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("extends a parent generation when a child tool ends later", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_timing",
      name: "support-agent",
    });
    await processor.onSpanStart({
      traceId: "trace_timing",
      spanId: "span_generation",
      spanData: { type: "generation", model: "gpt-4o" },
      startedAt: "2026-06-29T10:00:00.000Z",
    });
    await processor.onSpanStart({
      traceId: "trace_timing",
      spanId: "span_tool",
      parentId: "span_generation",
      spanData: { type: "function", name: "search_docs" },
      startedAt: "2026-06-29T10:00:00.050Z",
    });
    await processor.onSpanEnd({
      traceId: "trace_timing",
      spanId: "span_generation",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "done" }],
      },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: "2026-06-29T10:00:00.100Z",
    });
    await processor.onSpanEnd({
      traceId: "trace_timing",
      spanId: "span_tool",
      parentId: "span_generation",
      spanData: {
        type: "function",
        name: "search_docs",
        output: JSON.stringify({ ok: true }),
      },
      startedAt: "2026-06-29T10:00:00.050Z",
      endedAt: "2026-06-29T10:00:00.180Z",
    });
    await processor.onTraceEnd({
      traceId: "trace_timing",
      name: "support-agent",
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const generation = body.trace.spans.find(
      (span: { id?: string }) => span.id === "span_generation",
    );
    const tool = body.trace.spans.find(
      (span: { id?: string }) => span.id === "span_tool",
    );
    expect(Date.parse(generation.ended_at)).toBeGreaterThanOrEqual(
      Date.parse(tool.ended_at),
    );
  });

  it("sends each trace once and does not resend on shutdown after it ends", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({ traceId: "trace_once", name: "agent" });
    await processor.onSpanStart({
      traceId: "trace_once",
      spanId: "span_gen",
      spanData: { type: "generation", model: "gpt-4o" },
    });
    await processor.onSpanEnd({
      traceId: "trace_once",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "hi" }],
      },
    });
    await processor.onTraceEnd({ traceId: "trace_once", name: "agent" });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A shutdown/forceFlush after the trace already ended must not re-send it,
    // which would duplicate every span in the append-only ingest store.
    await processor.forceFlush();
    await processor.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not resend after forceFlush when a late onTraceEnd arrives", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({ traceId: "trace_flush", name: "agent" });
    await processor.onSpanStart({
      traceId: "trace_flush",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "hi" }],
        model: "gpt-4o",
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_flush",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "hello" }],
      },
    });
    await processor.forceFlush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await processor.onTraceEnd({ traceId: "trace_flush", name: "agent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records response spans from live response payloads", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_response",
      name: "support-agent",
    });
    await processor.onSpanStart({
      traceId: "trace_response",
      spanId: "span_response",
      spanData: {
        type: "response",
        input: [{ role: "user", content: "status?" }],
        model: "gpt-4o",
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_response",
      spanId: "span_response",
      spanData: {
        type: "response",
        input: [{ role: "user", content: "status?" }],
        model: "gpt-4o",
        response: { output_text: "Ships Friday." },
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_response",
      name: "support-agent",
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "status?",
      output: "Ships Friday.",
    });
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      name: "openai-agents-response",
      output: "Ships Friday.",
    });
  });

  it("fails the root only for terminal hard errors, not soft tool errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_soft",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_soft",
      spanId: "span_tool",
      spanData: {
        type: "function",
        name: "lookup",
        output: JSON.stringify({
          isError: true,
          content: [{ type: "text", text: "tool failed" }],
        }),
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_soft",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "retry" }],
        output: [{ role: "assistant", content: "recovered" }],
        model: "gpt-4o",
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_soft",
      name: "support-agent",
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "retry",
      output: "recovered",
    });
    expect(body.trace).not.toHaveProperty("status");
    expect(body.trace.spans[0]).toMatchObject({
      status: "ERROR",
      error: "tool failed",
    });
  });

  it("records root failure from agent hard errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_agent_err",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_agent_err",
      spanId: "span_agent",
      spanData: { type: "agent", name: "support-agent" },
      error: { message: "agent crashed" },
    });
    await processor.onTraceEnd({
      traceId: "trace_agent_err",
      name: "support-agent",
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "agent crashed",
    });
    expect(body.trace).not.toHaveProperty("output");
  });

  it("promotes configurable identity keys from metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      threadIdKey: "conversationId",
      userIdKey: "customerId",
    });

    await processor.onTraceStart({
      traceId: "trace_keys",
      name: "support-agent",
      metadata: {
        conversationId: "conv-9",
        customerId: "cust-3",
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_keys",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "hello" }],
        output: [{ role: "assistant", content: "hi" }],
        model: "gpt-4o",
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_keys",
      name: "support-agent",
      metadata: {
        conversationId: "conv-9",
        customerId: "cust-3",
      },
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      thread_id: "conv-9",
      user_id: "cust-3",
    });
  });

  it("logs OpenAI Agents spans as they start and end in debug mode", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_openai_2",
      name: "debug-agent",
    });
    await processor.onSpanStart({
      traceId: "trace_openai_2",
      spanId: "span_generation_2",
      spanData: { type: "generation", model: "gpt-4o" },
    });
    await processor.onSpanStart({
      traceId: "trace_openai_2",
      spanId: "span_tool_2",
      parentId: "span_generation_2",
      spanData: { type: "function", name: "lookup", input: "{}" },
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[LEMMA:client] span started",
      expect.objectContaining({
        traceId: expect.any(String),
        span: expect.objectContaining({
          id: "span_generation_2",
          type: "generation",
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "[LEMMA:client] span started",
      expect.objectContaining({
        span: expect.objectContaining({
          id: "span_tool_2",
          parentId: "span_generation_2",
          type: "tool",
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await processor.onSpanEnd({
      traceId: "trace_openai_2",
      spanId: "span_tool_2",
      parentId: "span_generation_2",
      spanData: {
        type: "function",
        name: "lookup",
        input: "{}",
        output: "{}",
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_openai_2",
      spanId: "span_generation_2",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "hello" }],
      },
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[LEMMA:client] span ended",
      expect.objectContaining({
        traceId: expect.any(String),
        span: expect.objectContaining({
          id: "span_generation_2",
          type: "generation",
          hasOutput: true,
        }),
      }),
    );

    await processor.onTraceEnd({
      traceId: "trace_openai_2",
      name: "debug-agent",
    });
  });
});
