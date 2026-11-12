import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { disableDebugMode, enableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

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
    await processor.forceFlush();

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

  it("records span input the Agents SDK sets after the span starts", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    // The Agents SDK hands the processor one live spanData object and fills
    // input/output on it after onSpanStart has already run.
    const generation = {
      traceId: "trace_late_input",
      spanId: "span_generation_late",
      spanData: { type: "generation" } as Record<string, unknown> & {
        type: string;
      },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: null as string | null,
    };
    const tool = {
      traceId: "trace_late_input",
      spanId: "span_tool_late",
      parentId: "span_generation_late",
      spanData: {
        type: "function",
        name: "repo_push",
        input: "",
        output: "",
      } as Record<string, unknown> & { type: string },
      startedAt: "2026-06-29T10:00:00.050Z",
      endedAt: null as string | null,
    };

    await processor.onTraceStart({
      traceId: "trace_late_input",
      name: "scan-agent",
    });
    await processor.onSpanStart(generation);
    generation.spanData.input = [{ role: "user", content: "push the repo" }];
    await processor.onSpanStart(tool);
    tool.spanData.input = JSON.stringify({ repo: "acme/app" });
    tool.spanData.output = JSON.stringify({ status: "committed" });
    tool.endedAt = "2026-06-29T10:00:00.090Z";
    await processor.onSpanEnd(tool);
    generation.spanData.output = [{ role: "assistant", content: "Pushed." }];
    generation.endedAt = "2026-06-29T10:00:00.125Z";
    await processor.onSpanEnd(generation);
    await processor.onTraceEnd({
      traceId: "trace_late_input",
      name: "scan-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    const [generationSpan, toolSpan] = body.trace.spans;
    expect(generationSpan).toMatchObject({
      id: "span_generation_late",
      input: [{ role: "user", content: "push the repo" }],
      attributes: {
        "llm.input_messages.0.message.role": "user",
        "llm.input_messages.0.message.content": "push the repo",
      },
    });
    expect(
      JSON.parse(generationSpan.attributes["openai.agents.span_data"]),
    ).toMatchObject({ input: [{ role: "user", content: "push the repo" }] });
    expect(toolSpan).toMatchObject({
      id: "span_tool_late",
      input: { repo: "acme/app" },
      output: { status: "committed" },
    });
    expect(
      JSON.parse(toolSpan.attributes["openai.agents.span_data"]),
    ).toMatchObject({
      input: JSON.stringify({ repo: "acme/app" }),
      output: JSON.stringify({ status: "committed" }),
    });
    expect(body.trace.input).toBe("push the repo");
  });

  it.each([
    ["missing", {}],
    ["null", { input: null }],
  ])(
    "keeps a start-time input when the span ends with %s input",
    async (_label, endInput) => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
      const processor = openAIAgents({
        apiKey: "key",
        projectId: "10000000-0000-0000-0000-000000000001",
        fetch: fetchMock as typeof fetch,
      });

      await processor.onTraceStart({ traceId: "trace_kept", name: "agent" });
      await processor.onSpanStart({
        traceId: "trace_kept",
        spanId: "span_custom_kept",
        spanData: { type: "custom", name: "step", input: "start input" },
      });
      await processor.onSpanEnd({
        traceId: "trace_kept",
        spanId: "span_custom_kept",
        spanData: { type: "custom", name: "step", ...endInput },
      });
      await processor.onTraceEnd({ traceId: "trace_kept", name: "agent" });
      await processor.forceFlush();

      const body = jsonBody(fetchMock.mock.calls[0]);
      expect(body.trace.spans[0].input).toBe("start input");
    },
  );

  it("extracts usage from spanData.usage and sets openai-agents provenance", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_usage",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_usage",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        input: [{ role: "user", content: "hi" }],
        output: [{ role: "assistant", content: "hello" }],
        usage: {
          input_tokens: 8,
          output_tokens: 2,
          // Agents / Responses API shape (not Chat Completions prompt_tokens_details).
          input_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
      },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: "2026-06-29T10:00:00.050Z",
    });
    await processor.onTraceEnd({
      traceId: "trace_usage",
      name: "support-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      usage: {
        input_tokens: 8,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 1,
        reasoning_output_tokens: 2,
      },
      attributes: {
        "llm.provider": "openai",
        "lemma.sdk.integration": "openai-agents",
        "gen_ai.usage.input_tokens": 8,
        "gen_ai.usage.output_tokens": 2,
        "gen_ai.usage.cache_read.input_tokens": 3,
        "gen_ai.usage.cache_creation.input_tokens": 1,
        "gen_ai.usage.reasoning.output_tokens": 2,
      },
    });
  });

  it("stamps run result usage when the span event omits it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_result_usage",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_result_usage",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        input: [{ role: "user", content: "hi" }],
        output: [{ role: "assistant", content: "hello" }],
      },
    });
    expect(
      processor.recordResult({
        rawResponses: [{ usage: { input_tokens: 8, output_tokens: 2 } }],
      }),
    ).toBe(1);
    await processor.onTraceEnd({
      traceId: "trace_result_usage",
      name: "support-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      usage: { input_tokens: 8, output_tokens: 2 },
    });
  });

  it("omits usage when the span event and run result have no token facts", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_no_usage",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_no_usage",
      spanId: "span_gen",
      spanData: {
        type: "generation",
        model: "gpt-4o",
        output: [{ role: "assistant", content: "hello" }],
      },
    });
    expect(processor.recordResult({ rawResponses: [{}] })).toBe(0);
    await processor.onTraceEnd({
      traceId: "trace_no_usage",
      name: "support-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).not.toHaveProperty("usage");
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
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "pdf_server_pdf",
      type: "tool",
      status: "ERROR",
      error: "Internal error: Validation error",
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("records function spans with payload-encoded error as error without output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_payload_err",
      name: "support-agent",
    });
    await processor.onSpanStart({
      traceId: "trace_payload_err",
      spanId: "span_tool",
      spanData: {
        type: "function",
        name: "return_delivered_order_items",
        input: JSON.stringify({ order_id: "#W-001" }),
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_payload_err",
      spanId: "span_tool",
      spanData: {
        type: "function",
        name: "return_delivered_order_items",
        input: JSON.stringify({ order_id: "#W-001" }),
        output: JSON.stringify({
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Error: Payment method not found",
              }),
            },
          ],
          structuredContent: { error: "Error: Payment method not found" },
        }),
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_payload_err",
      name: "support-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "return_delivered_order_items",
      type: "tool",
      status: "ERROR",
      error: "Error: Payment method not found",
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
    await processor.forceFlush();

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
    await processor.forceFlush();

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
    await processor.forceFlush();
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
    await processor.forceFlush();

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
    await processor.forceFlush();

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
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "agent crashed",
    });
    expect(body.trace).not.toHaveProperty("output");
  });

  it("records root failure from a message-less agent error", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_agent_bare_err",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_agent_bare_err",
      spanId: "span_agent",
      spanData: { type: "agent", name: "support-agent" },
      error: { data: { code: 500 } },
    });
    await processor.onTraceEnd({
      traceId: "trace_agent_bare_err",
      name: "support-agent",
    });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: '{"data":{"code":500}}',
    });
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
    await processor.forceFlush();

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
    await processor.forceFlush();
  });

  it("forwards release onto the ingest payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      release: "1.8.3",
    });

    await processor.onTraceStart({
      traceId: "trace_openai_release",
      name: "support-agent",
    });
    await processor.onTraceEnd({
      traceId: "trace_openai_release",
      name: "support-agent",
    });
    await processor.forceFlush();

    expect(jsonBody(fetchMock.mock.calls[0]).trace.release).toBe("1.8.3");
  });

  it("copies model from the response payload when spanData.model is unset", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_openai_model",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_openai_model",
      spanId: "span_generation_model",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "hi" }],
        output: [{ role: "assistant", content: "hello" }],
        response: { model: "o3-mini" },
      },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: "2026-06-29T10:00:00.050Z",
    });
    await processor.onTraceEnd({
      traceId: "trace_openai_model",
      name: "support-agent",
    });
    await processor.forceFlush();

    expect(jsonBody(fetchMock.mock.calls[0]).trace.spans[0]).toMatchObject({
      type: "generation",
      model: "o3-mini",
      attributes: {
        "llm.model_name": "o3-mini",
        "gen_ai.request.model": "o3-mini",
        "ai.model.id": "o3-mini",
      },
    });
  });

  it("records model, instructions, output, tools, and settings from a streamed _response", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const tools = [
      {
        type: "function",
        name: "lookup_order",
        parameters: { type: "object" },
      },
    ];
    const output = [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "It arrives Friday." }],
      },
    ];
    const span = {
      traceId: "trace_streamed_response",
      spanId: "span_streamed_response",
      spanData: {
        type: "response",
        _input: [{ role: "user", content: "where is my order?" }],
      } as Record<string, unknown> & { type: string },
      startedAt: "2026-06-29T10:00:00.000Z",
      endedAt: null as string | null,
    };

    await processor.onTraceStart({
      traceId: "trace_streamed_response",
      name: "support-agent",
    });
    await processor.onSpanStart(span);
    span.spanData._response = {
      model: "gpt-4.1",
      instructions: "Answer briefly.",
      tools,
      temperature: 0.2,
      top_p: 1,
      max_output_tokens: 256,
      tool_choice: "auto",
      output,
    };
    span.endedAt = "2026-06-29T10:00:00.080Z";
    await processor.onSpanEnd(span);
    await processor.onTraceEnd({
      traceId: "trace_streamed_response",
      name: "support-agent",
    });
    await processor.forceFlush();

    const recorded = jsonBody(fetchMock.mock.calls[0]).trace.spans[0];
    expect(recorded).toMatchObject({
      type: "generation",
      model: "gpt-4.1",
      attributes: {
        "llm.model_name": "gpt-4.1",
        "gen_ai.request.model": "gpt-4.1",
        "ai.model.id": "gpt-4.1",
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content": "Answer briefly.",
        "llm.input_messages.1.message.role": "user",
        "llm.input_messages.1.message.content": "where is my order?",
        "llm.output_messages.0.message.role": "assistant",
        "llm.output_messages.0.message.type": "message",
        "llm.tools": JSON.stringify(tools),
        "llm.invocation_parameters": JSON.stringify({
          temperature: 0.2,
          top_p: 1,
          max_output_tokens: 256,
          tool_choice: "auto",
        }),
      },
    });
    expect(
      JSON.parse(recorded.attributes["openai.agents.span_data"]).response,
    ).toBeUndefined();
  });

  it("marks tool calls, tool results, and reasoning items with a role", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const history = [
      { role: "user", content: "look up the order" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "lookup_order",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "Friday",
      },
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        type: "function_call_result",
        call_id: "call_2",
        output: "kept",
      },
      { type: "function_call", role: "user", name: "custom" },
    ];

    await processor.onTraceStart({
      traceId: "trace_roles",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_roles",
      spanId: "span_roles",
      spanData: {
        type: "response",
        _input: history,
        _response: {
          model: "gpt-4.1",
          output: [{ type: "message", role: "assistant", content: "Friday" }],
        },
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_roles",
      name: "support-agent",
    });
    await processor.forceFlush();

    const attributes = jsonBody(fetchMock.mock.calls[0]).trace.spans[0]
      .attributes;
    expect(attributes["llm.input_messages.0.message.role"]).toBe("user");
    expect(attributes["llm.input_messages.1.message.role"]).toBe("assistant");
    expect(attributes["llm.input_messages.1.message.type"]).toBe(
      "function_call",
    );
    expect(attributes["llm.input_messages.2.message.role"]).toBe("tool");
    expect(attributes["llm.input_messages.2.message.type"]).toBe(
      "function_call_output",
    );
    expect(attributes["llm.input_messages.3.message.role"]).toBe("assistant");
    expect(attributes["llm.input_messages.3.message.type"]).toBe("reasoning");
    expect(attributes["llm.input_messages.4.message.role"]).toBe("tool");
    expect(attributes["llm.input_messages.4.message.type"]).toBe(
      "function_call_result",
    );
    expect(attributes["llm.input_messages.5.message.role"]).toBe("user");
  });
});
