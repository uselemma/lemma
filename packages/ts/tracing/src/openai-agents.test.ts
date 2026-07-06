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
      thread_id: "thread-1",
      metadata: {
        userId: "user-1",
        openaiAgentsTraceId: "trace_openai_1",
        openaiAgentsGroupId: "thread-1",
      },
    });
    expect(body.trace.id).not.toBe("trace_openai_1");
    expect(body.trace.spans).toMatchObject([
      {
        id: "span_generation_1",
        name: "openai-agents-generation",
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: "It arrives Friday.",
        model: "gpt-4o",
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
