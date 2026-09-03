import { describe, expect, it, vi } from "vitest";
import { Lemma } from "./client";
import { vercelAI } from "./vercel-ai";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("vercelAI", () => {
  it("creates and ends an AI SDK v7 trace without lemma.trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "where is my order?",
    });

    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [{ role: "user", content: "where is my order?" }],
    } as never);

    integration.onStepEnd?.({
      callId: "call-1",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "It arrives Friday.",
      performance: { responseTimeMs: 100, stepTimeMs: 100 },
    } as never);

    await integration.onEnd?.({ text: "It arrives Friday." });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "where is my order?",
      output: "It arrives Friday.",
    });
    expect(body.trace.spans).toMatchObject([
      {
        name: "vercel-ai-generation",
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: "It arrives Friday.",
        model: "gpt-4o",
      },
    ]);
  });

  it("uses vercelAI agentName for managed traces", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      agentName: "docs-agent",
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onLanguageModelCallStart?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    } as never);

    integration.onLanguageModelCallEnd?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      content: [{ type: "text", text: "hi" }],
      performance: { responseTimeMs: 10 },
    } as never);

    await integration.onEnd?.({ text: "hi" });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "docs-agent",
      input: "hello",
      output: "hi",
    });
  });

  it("emits usage from language-model end when present", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      agentName: "docs-agent",
    });

    integration.onLanguageModelCallStart?.({
      callId: "call-usage",
      provider: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    } as never);

    integration.onLanguageModelCallEnd?.({
      callId: "call-usage",
      provider: "openai",
      modelId: "gpt-4o",
      content: [{ type: "text", text: "hi" }],
      performance: { responseTimeMs: 10 },
      usage: {
        inputTokens: 15,
        outputTokens: 4,
        // AI SDK 7 nested details (top-level reasoningTokens/cachedInputTokens deprecated).
        inputTokenDetails: {
          cacheReadTokens: 5,
          cacheWriteTokens: 2,
        },
        outputTokenDetails: {
          reasoningTokens: 2,
        },
      },
    } as never);

    await integration.onEnd?.({ text: "hi" });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      usage: {
        input_tokens: 15,
        output_tokens: 4,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 2,
        reasoning_output_tokens: 2,
      },
      attributes: {
        "llm.provider": "openai",
        "lemma.sdk.integration": "vercel-ai",
        "gen_ai.usage.input_tokens": 15,
        "gen_ai.usage.output_tokens": 4,
        "gen_ai.usage.cache_read.input_tokens": 5,
        "gen_ai.usage.cache_creation.input_tokens": 2,
        "gen_ai.usage.reasoning.output_tokens": 2,
      },
    });
  });

  it("stamps generateText usage when the finish event omits it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    expect(
      integration.recordResult({
        usage: { inputTokens: 15, outputTokens: 4 },
        totalUsage: { inputTokens: 15, outputTokens: 4 },
      }),
    ).toBe(1);
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      usage: { input_tokens: 15, output_tokens: 4 },
    });
  });

  it("zips per-step usage and does not copy the same total onto every span", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    integration.onStepStart?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      messages: [{ role: "user", content: "hello" }],
    });
    integration.onStepFinish?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "step one",
    });
    integration.onStepStart?.({
      stepNumber: 1,
      model: { provider: "openai", modelId: "gpt-4o" },
      messages: [{ role: "user", content: "hello" }],
    });
    integration.onStepFinish?.({
      stepNumber: 1,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "step two",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "step two",
    });
    integration.recordResult({
      totalUsage: { inputTokens: 30, outputTokens: 9 },
      steps: [
        { usage: { inputTokens: 10, outputTokens: 3 } },
        { usage: { inputTokens: 20, outputTokens: 6 } },
      ],
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    const generations = body.trace.spans.filter(
      (span: { type?: string }) => span.type === "generation",
    );
    expect(generations).toHaveLength(2);
    expect(generations[0].usage).toEqual({
      input_tokens: 10,
      output_tokens: 3,
    });
    expect(generations[1].usage).toEqual({
      input_tokens: 20,
      output_tokens: 6,
    });
  });

  it("omits usage when the event and result have no token facts", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    expect(integration.recordResult({ totalTokens: 12, steps: [] })).toBe(0);
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).not.toHaveProperty("usage");
    expect(body.trace.spans[0].attributes).not.toHaveProperty(
      "gen_ai.usage.input_tokens",
    );
  });

  it("creates and ends an AI SDK v6 trace without lemma.trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "hello",
      output: "hi",
    });
    expect(body.trace.spans).toMatchObject([
      {
        name: "vercel-ai-generation",
        type: "generation",
        input: [{ role: "user", content: "hello" }],
        output: "hi",
      },
    ]);
  });

  it("nests current AI SDK tool callbacks under the live generation", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "find docs",
    });
    integration.onStepStart?.({
      functionId: "support-agent",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      messages: [{ role: "user", content: "find docs" }],
      tools: { search_docs: { description: "Search docs" } },
    });
    integration.onToolCallStart?.({
      toolCall: {
        toolName: "search_docs",
        toolCallId: "tool-1",
        input: { query: "docs" },
      },
    } as never);
    integration.onToolCallFinish?.({
      toolCall: {
        toolName: "search_docs",
        toolCallId: "tool-1",
        input: { query: "docs" },
      },
      durationMs: 25,
      success: true,
      output: [{ title: "Docs" }],
    } as never);
    integration.onStepFinish?.({
      functionId: "support-agent",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Found docs.",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Found docs.",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    const [generation, tool] = body.trace.spans;
    expect(generation).toMatchObject({
      name: "vercel-ai-generation",
      type: "generation",
      input: [{ role: "user", content: "find docs" }],
      output: "Found docs.",
    });
    expect(tool).toMatchObject({
      parent_id: generation.id,
      name: "search_docs",
      type: "tool",
      input: { query: "docs" },
      output: [{ title: "Docs" }],
    });
  });

  it("records AI SDK v7 step timing and nests tools under the generating step", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStepStart?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        stepNumber: 0,
        messages: [{ role: "user", content: "where is my order?" }],
        tools: [{ type: "function", name: "search_docs" }],
      } as never);

      integration.onLanguageModelCallStart?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        messages: [{ role: "user", content: "where is my order?" }],
        tools: [{ type: "function", name: "search_docs" }],
      } as never);

      integration.onLanguageModelCallEnd?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        content: [{ type: "text", text: "I should search docs." }],
        performance: { responseTimeMs: 100 },
      } as never);

      integration.onToolExecutionStart?.({
        callId: "call-1",
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "order" },
        },
      } as never);

      integration.onToolExecutionEnd?.({
        callId: "call-1",
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "order" },
        },
        toolExecutionMs: 25,
        toolOutput: { type: "tool-result", output: [{ title: "Shipping" }] },
        messages: [{ role: "user", content: "where is my order?" }],
      } as never);

      integration.onStepEnd?.({
        callId: "call-1",
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "I should search docs.",
        performance: {
          responseTimeMs: 100,
          stepTimeMs: 150,
          toolExecutionMs: { "tool-1": 25 },
        },
        toolCalls: [
          {
            toolName: "search_docs",
            toolCallId: "tool-1",
            input: { query: "order" },
          },
        ],
      } as never);

      return "It arrives Friday.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const [generation, tool] = body.trace.spans;
    expect(generation).toMatchObject({
      name: "vercel-ai-generation",
      type: "generation",
      input: [{ role: "user", content: "where is my order?" }],
      output: "I should search docs.",
      model: "gpt-4o",
      duration_ms: 150,
    });
    expect(
      Date.parse(generation.ended_at) - Date.parse(generation.started_at),
    ).toBe(150);
    expect(tool).toMatchObject({
      parent_id: generation.id,
      name: "search_docs",
      type: "tool",
      input: { query: "order" },
      output: [{ title: "Shipping" }],
      duration_ms: 25,
    });
    expect(Date.parse(tool.ended_at) - Date.parse(tool.started_at)).toBe(25);
  });

  it("records AI SDK model calls and tool executions", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onLanguageModelCallStart?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        messages: [{ role: "user", content: "where is my order?" }],
        tools: [{ type: "function", name: "search_docs" }],
      } as never);

      integration.onLanguageModelCallEnd?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        content: [{ type: "text", text: "It arrives Friday." }],
        performance: { responseTimeMs: 125 },
      } as never);

      integration.onToolExecutionEnd?.({
        callId: "call-1",
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "order" },
        },
        toolExecutionMs: 25,
        toolOutput: { type: "tool-result", output: [{ title: "Shipping" }] },
        messages: [{ role: "user", content: "where is my order?" }],
      } as never);

      return "It arrives Friday.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toMatchObject([
      {
        name: "vercel-ai-generation",
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: "It arrives Friday.",
        model: "gpt-4o",
        duration_ms: 125,
        attributes: {
          "llm.provider": "openai",
          "llm.input_messages.0.message.role": "user",
          "llm.input_messages.0.message.content": "where is my order?",
          "llm.output_messages.0.message.role": "assistant",
          "llm.output_messages.0.message.content": "It arrives Friday.",
          "llm.tools": JSON.stringify([
            { type: "function", name: "search_docs" },
          ]),
        },
      },
      {
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
        duration_ms: 25,
      },
    ]);
  });

  it("records inputs and outputs on generations and tools", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onLanguageModelCallStart?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        messages: [{ role: "user", content: "secret" }],
      } as never);

      integration.onLanguageModelCallEnd?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        content: [{ type: "text", text: "secret answer" }],
        performance: { responseTimeMs: 10 },
      } as never);

      integration.onToolExecutionEnd?.({
        callId: "call-1",
        toolCall: {
          toolName: "lookup",
          toolCallId: "tool-1",
          input: { secret: "tool input" },
        },
        toolExecutionMs: 5,
        toolOutput: { type: "tool-result", output: { secret: "tool output" } },
        messages: [{ role: "user", content: "secret" }],
      } as never);

      return "ok";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0].input).toEqual([
      { role: "user", content: "secret" },
    ]);
    expect(body.trace.spans[0].output).toBeDefined();
    expect(body.trace.spans[0].attributes).toHaveProperty(
      "llm.input_messages.0.message.content",
    );
    expect(body.trace.spans[0].attributes).toHaveProperty(
      "llm.output_messages.0.message.content",
    );
    expect(body.trace.spans[1].input).toEqual({ secret: "tool input" });
    expect(body.trace.spans[1].output).toEqual({ secret: "tool output" });
  });

  it("records AI SDK v6 step and tool callbacks", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStart?.({
        model: { provider: "openai", modelId: "gpt-4o" },
        prompt: "where is my order?",
      });

      integration.onStepStart?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        messages: [{ role: "user", content: "where is my order?" }],
        tools: { search_docs: { description: "Search docs" } },
      });

      integration.onStepFinish?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "It arrives Friday.",
      });

      integration.onToolCallFinish?.({
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "order" },
        },
        durationMs: 25,
        success: true,
        output: [{ title: "Shipping" }],
      } as never);

      return "It arrives Friday.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toMatchObject([
      {
        name: "vercel-ai-generation",
        type: "generation",
        input: [{ role: "user", content: "where is my order?" }],
        output: "It arrives Friday.",
        model: "gpt-4o",
        attributes: {
          "llm.provider": "openai",
          "llm.input_messages.0.message.content": "where is my order?",
          "llm.output_messages.0.message.content": "It arrives Friday.",
          "llm.tools": JSON.stringify({
            search_docs: { description: "Search docs" },
          }),
        },
      },
      {
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
        duration_ms: 25,
      },
    ]);
  });

  it("falls back to AI SDK v6 finish callbacks when step callbacks are absent", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStart?.({
        model: { provider: "openai", modelId: "gpt-4o" },
        prompt: "hello",
      });

      integration.onFinish?.({
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "hi",
      });

      return "hi";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toMatchObject([
      {
        name: "vercel-ai-generation",
        type: "generation",
        input: [{ role: "user", content: "hello" }],
        output: "hi",
        model: "gpt-4o",
      },
    ]);
  });

  it("ends an explicit trace handle from AI SDK v7 onEnd", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const trace = lemma.trace({ name: "support-agent", input: "hello" });
    const integration = vercelAI({ trace });

    await integration.onEnd?.({ text: "hi" });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "hello",
      output: "hi",
    });
  });

  it("ends an explicit trace handle from AI SDK v6 onFinish", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const trace = lemma.trace({ name: "support-agent", input: "hello" });
    const integration = vercelAI({ trace });

    integration.onStart?.({
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onFinish?.({
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "hello",
      output: "hi",
    });
  });

  it("records MCP isError tool results as error without output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStepStart?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        messages: [{ role: "user", content: "search pdf" }],
      });
      integration.onToolCallFinish?.({
        toolCall: {
          toolName: "pdf_server_pdf",
          toolCallId: "tool-1",
          input: { query: "YAT" },
        },
        durationMs: 40,
        success: true,
        output: {
          content: [
            {
              text: "Internal error: Validation error: request: Missing required argument",
              type: "text",
            },
          ],
          isError: true,
        },
      } as never);
      integration.onStepFinish?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "I hit an error.",
      });

      return "I hit an error.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const tool = body.trace.spans.find(
      (span: { type?: string }) => span.type === "tool",
    );
    expect(tool).toMatchObject({
      name: "pdf_server_pdf",
      type: "tool",
      status: "ERROR",
      error:
        "Internal error: Validation error: request: Missing required argument",
    });
    expect(tool).not.toHaveProperty("output");
  });

  it("records MCP isError:false payloads with structuredContent.error as span errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStepStart?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        messages: [{ role: "user", content: "return the camera" }],
      });
      integration.onToolCallFinish?.({
        toolCall: {
          toolName: "return_delivered_order_items",
          toolCallId: "tool-1",
          input: { order_id: "#W-001" },
        },
        durationMs: 40,
        success: true,
        output: {
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
        },
      } as never);
      integration.onStepFinish?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "The return could not be completed.",
      });

      return "The return could not be completed.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const tool = body.trace.spans.find(
      (span: { type?: string }) => span.type === "tool",
    );
    expect(tool).toMatchObject({
      name: "return_delivered_order_items",
      type: "tool",
      status: "ERROR",
      error: "Error: Payment method not found",
    });
    expect(tool).not.toHaveProperty("output");
  });

  it("keeps v6 tool timing inside the parent generation window", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStepStart?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        messages: [{ role: "user", content: "find docs" }],
      });
      // Step can finish before trailing tool callbacks in AI SDK v6.
      integration.onStepFinish?.({
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "Found docs.",
      });
      integration.onToolCallFinish?.({
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "docs" },
        },
        durationMs: 25,
        success: true,
        output: [{ title: "Docs" }],
      } as never);

      return "Found docs.";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const generation = body.trace.spans.find(
      (span: { type?: string }) => span.type === "generation",
    );
    const tool = body.trace.spans.find(
      (span: { type?: string }) => span.type === "tool",
    );
    expect(tool).toMatchObject({
      parent_id: generation.id,
      duration_ms: 25,
    });
    expect(Date.parse(tool.ended_at)).toBeGreaterThanOrEqual(
      Date.parse(tool.started_at),
    );
    expect(Date.parse(tool.ended_at) - Date.parse(tool.started_at)).toBe(25);
    expect(Date.parse(generation.ended_at)).toBeGreaterThanOrEqual(
      Date.parse(tool.ended_at),
    );
  });

  it("records v7 tool-error without inventing an output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({ trace });

      integration.onStepStart?.({
        callId: "call-1",
        provider: "openai",
        modelId: "gpt-4o",
        stepNumber: 0,
        messages: [{ role: "user", content: "lookup" }],
      } as never);
      integration.onToolExecutionEnd?.({
        callId: "call-1",
        toolCall: {
          toolName: "lookup",
          toolCallId: "tool-1",
          input: { id: "1" },
        },
        toolExecutionMs: 10,
        toolOutput: {
          type: "tool-error",
          error: "lookup failed",
        },
      } as never);
      integration.onStepEnd?.({
        callId: "call-1",
        stepNumber: 0,
        model: { provider: "openai", modelId: "gpt-4o" },
        text: "failed",
        performance: { stepTimeMs: 50, responseTimeMs: 40 },
      } as never);

      return "failed";
    });

    const body = jsonBody(fetchMock.mock.calls[0]);
    const tool = body.trace.spans.find(
      (span: { type?: string }) => span.type === "tool",
    );
    expect(tool).toMatchObject({
      name: "lookup",
      status: "ERROR",
      error: "lookup failed",
    });
    expect(tool).not.toHaveProperty("output");
  });

  it("promotes threadId and userId from telemetry metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      messages: [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "older turn" },
        { role: "assistant", content: "prior answer" },
        { role: "user", content: "current turn" },
      ],
      metadata: {
        threadId: "thread-42",
        userId: "user-7",
      },
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "done",
      metadata: {
        threadId: "thread-42",
        userId: "user-7",
      },
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "current turn",
      output: "done",
      thread_id: "thread-42",
      user_id: "user-7",
    });
    expect(body.trace.spans[0]).toMatchObject({
      attributes: {
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.3.message.content": "current turn",
      },
    });
  });

  it("normalizes v6 system + prompt into generation messages", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "You are concise.",
      prompt: "Summarize shipping.",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Ships Friday.",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.input).toBe("Summarize shipping.");
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Summarize shipping." },
      ],
      attributes: {
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.1.message.content": "Summarize shipping.",
      },
    });
  });

  it("prepends v6 system onto generation messages when messages is also set", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Follow the playbook.",
      messages: [{ role: "user", content: "where is my order?" }],
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "It arrives Friday.",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.input).toBe("where is my order?");
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "Follow the playbook." },
        { role: "user", content: "where is my order?" },
      ],
      attributes: {
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content": "Follow the playbook.",
        "llm.input_messages.1.message.content": "where is my order?",
      },
    });
  });

  it("prepends onStart system onto v7 step generations that only receive messages", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Follow the playbook.",
      messages: [{ role: "user", content: "where is my order?" }],
    });
    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [{ role: "user", content: "where is my order?" }],
    } as never);
    integration.onStepEnd?.({
      callId: "call-1",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "It arrives Friday.",
      performance: { responseTimeMs: 100, stepTimeMs: 100 },
    } as never);
    await integration.onEnd?.({ text: "It arrives Friday." });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "Follow the playbook." },
        { role: "user", content: "where is my order?" },
      ],
      attributes: {
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content": "Follow the playbook.",
      },
    });
  });

  it("records a later step's instructions instead of the onStart system", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Follow the playbook.",
      messages: [{ role: "user", content: "where is my order?" }],
    });
    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [{ role: "user", content: "where is my order?" }],
    } as never);
    integration.onStepEnd?.({
      callId: "call-1",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Looking up.",
      performance: { responseTimeMs: 40, stepTimeMs: 40 },
      toolCalls: [{ toolCallId: "tool-1", toolName: "lookup" }],
    } as never);
    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-2",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 1,
      instructions: "Use the lookup result. Be brief.",
      messages: [
        { role: "user", content: "where is my order?" },
        { role: "assistant", content: "Looking up." },
      ],
    } as never);
    integration.onStepEnd?.({
      callId: "call-2",
      stepNumber: 1,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "It arrives Friday.",
      performance: { responseTimeMs: 50, stepTimeMs: 50 },
    } as never);
    await integration.onEnd?.({ text: "It arrives Friday." });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans).toHaveLength(2);
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "Follow the playbook." },
        { role: "user", content: "where is my order?" },
      ],
    });
    expect(body.trace.spans[1]).toMatchObject({
      input: [
        { role: "system", content: "Use the lookup result. Be brief." },
        { role: "user", content: "where is my order?" },
        { role: "assistant", content: "Looking up." },
      ],
      attributes: {
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content":
          "Use the lookup result. Be brief.",
      },
    });
  });

  it("prepends onStart instructions onto v7 step generations", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      instructions: "Be brief.",
      messages: [{ role: "user", content: "status?" }],
    });
    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [{ role: "user", content: "status?" }],
    } as never);
    integration.onStepEnd?.({
      callId: "call-1",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Shipped.",
      performance: { responseTimeMs: 20, stepTimeMs: 20 },
    } as never);
    await integration.onEnd?.({ text: "Shipped." });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "status?" },
      ],
      attributes: {
        "llm.input_messages.0.message.content": "Be brief.",
      },
    });
  });

  it("does not prepend onStart system when later messages already start with a different system", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Old playbook.",
      messages: [{ role: "user", content: "hello" }],
    });
    integration.onStepStart?.({
      functionId: "support-agent",
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [
        { role: "system", content: "New playbook." },
        { role: "user", content: "hello" },
      ],
    } as never);
    integration.onStepEnd?.({
      callId: "call-1",
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
      performance: { responseTimeMs: 10, stepTimeMs: 10 },
    } as never);
    await integration.onEnd?.({ text: "hi" });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0].input).toEqual([
      { role: "system", content: "New playbook." },
      { role: "user", content: "hello" },
    ]);
    expect(body.trace.spans[0].attributes).toMatchObject({
      "llm.input_messages.0.message.content": "New playbook.",
    });
  });

  it("records a v6 step system that differs from onStart", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Follow the playbook.",
      messages: [{ role: "user", content: "hello" }],
    });
    integration.onStepStart?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      system: "Use special instructions for this step.",
      messages: [{ role: "user", content: "hello" }],
    });
    integration.onStepFinish?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "done",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "done",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      input: [
        { role: "system", content: "Use special instructions for this step." },
        { role: "user", content: "hello" },
      ],
      attributes: {
        "llm.input_messages.0.message.content":
          "Use special instructions for this step.",
      },
    });
  });

  it("preserves structured assistant content on generations", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onLanguageModelCallStart?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "call tool" }],
    } as never);
    integration.onLanguageModelCallEnd?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      content: [
        { type: "text", text: "Looking up." },
        {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "lookup",
          input: { id: "1" },
        },
      ],
      performance: { responseTimeMs: 12 },
    } as never);
    await integration.onEnd?.({
      content: [
        { type: "text", text: "Looking up." },
        {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "lookup",
          input: { id: "1" },
        },
      ],
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0].output).toEqual([
      { type: "text", text: "Looking up." },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "lookup",
        input: { id: "1" },
      },
    ]);
  });

  it("fails fast on concurrent reuse and resets for sequential reuse", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "first",
    });
    expect(() =>
      integration.onStart?.({
        functionId: "support-agent",
        model: { provider: "openai", modelId: "gpt-4o" },
        prompt: "overlap",
      }),
    ).toThrow(/already tracing a run/);

    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "one",
    });
    await integration.flush();

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "second",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "two",
    });
    await integration.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jsonBody(fetchMock.mock.calls[0]).trace.input).toBe("first");
    expect(jsonBody(fetchMock.mock.calls[1]).trace.input).toBe("second");
  });

  it("fail() ends the owned trace with a root error", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "abort me",
    });
    await integration.fail(new Error("aborted by caller"));

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "abort me",
      status: "ERROR",
      error: "aborted by caller",
    });
    expect(body.trace).not.toHaveProperty("output");
  });

  it("fail() before telemetry still ingests a root error trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      agentName: "support-agent",
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await integration.fail(new Error("threw before callbacks"));

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      status: "ERROR",
      error: "threw before callbacks",
    });
  });

  it("ignores duplicate terminal events", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    await integration.flush();
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi again",
    });
    await integration.onEnd?.({ text: "hi again" });
    await integration.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("awaits outstanding deliveries on flush/shutdown", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    const finishPromise = integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "hi",
    });
    await finishPromise;

    const flushPromise = integration.flush();
    let flushed = false;
    void flushPromise.then(() => {
      flushed = true;
    });

    for (let i = 0; i < 10 && !resolveFetch; i++) {
      await Promise.resolve();
    }
    expect(resolveFetch).toBeTypeOf("function");
    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveFetch?.(new Response("{}", { status: 201 }));
    await flushPromise;
    expect(flushed).toBe(true);

    await integration.shutdown();
  });

  it("fails fast on concurrent v7 model calls without onStart", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onLanguageModelCallStart?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "one" }],
    } as never);

    expect(() =>
      integration.onLanguageModelCallStart?.({
        callId: "call-2",
        provider: "openai",
        modelId: "gpt-4o",
        messages: [{ role: "user", content: "two" }],
      } as never),
    ).toThrow(/already tracing a run/);
  });

  it("fails fast on concurrent v7 step-zero starts", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStepStart?.({
      callId: "call-1",
      provider: "openai",
      modelId: "gpt-4o",
      stepNumber: 0,
      messages: [{ role: "user", content: "one" }],
    } as never);

    expect(() =>
      integration.onStepStart?.({
        callId: "call-2",
        provider: "openai",
        modelId: "gpt-4o",
        stepNumber: 0,
        messages: [{ role: "user", content: "two" }],
      } as never),
    ).toThrow(/already tracing a run/);
  });

  it("does not throw for trailing tool callbacks during ending", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "find docs",
    });
    integration.onStepStart?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      messages: [{ role: "user", content: "find docs" }],
    });
    integration.onStepFinish?.({
      stepNumber: 0,
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Found docs.",
    });

    const finishPromise = integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "Found docs.",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(() =>
      integration.onToolCallFinish?.({
        toolCall: {
          toolName: "search_docs",
          toolCallId: "tool-1",
          input: { query: "docs" },
        },
        durationMs: 25,
        success: true,
        output: [{ title: "Docs" }],
      } as never),
    ).not.toThrow();

    const flushPromise = integration.flush();
    for (let i = 0; i < 10 && !resolveFetch; i++) {
      await Promise.resolve();
    }
    expect(resolveFetch).toBeTypeOf("function");
    resolveFetch?.(new Response("{}", { status: 201 }));
    await finishPromise;
    await flushPromise;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the full root error message", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "the failing prompt",
    });
    await integration.fail(new RangeError("context window exceeded"));

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "RangeError: context window exceeded",
      input: "the failing prompt",
    });
  });

  it("records real root wall-clock bounds", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "timing",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await integration.onFinish?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      text: "ok",
    });
    await integration.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.duration_ms).toBeGreaterThanOrEqual(15);
    expect(Date.parse(body.trace.ended_at)).toBeGreaterThan(
      Date.parse(body.trace.started_at),
    );
  });

  it("forwards release onto the ingest payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      release: "1.8.3",
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "where is my order?",
    });
    await integration.onEnd?.({ text: "It arrives Friday." });
    await integration.flush();

    expect(jsonBody(fetchMock.mock.calls[0]).trace.release).toBe("1.8.3");
  });

  it("flush does not throw when ingest returns 503", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    const integration = vercelAI({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    integration.onStart?.({
      functionId: "support-agent",
      model: { provider: "openai", modelId: "gpt-4o" },
      prompt: "hello",
    });
    await integration.onEnd?.({ text: "hi" });
    await expect(integration.flush()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
