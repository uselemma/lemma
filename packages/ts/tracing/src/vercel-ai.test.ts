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

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "docs-agent",
      input: [{ role: "user", content: "hello" }],
      output: "hi",
    });
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
        input: "hello",
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

  it("does not record inputs or outputs when disabled", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const lemma = new Lemma({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await lemma.trace("support-agent", async (trace) => {
      const integration = vercelAI({
        trace,
        recordInputs: false,
        recordOutputs: false,
      });

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
    expect(body.trace.spans[0]).not.toHaveProperty("input");
    expect(body.trace.spans[0]).not.toHaveProperty("output");
    expect(body.trace.spans[0].attributes).not.toHaveProperty(
      "llm.input_messages.0.message.content",
    );
    expect(body.trace.spans[0].attributes).not.toHaveProperty(
      "llm.output_messages.0.message.content",
    );
    expect(body.trace.spans[1]).not.toHaveProperty("input");
    expect(body.trace.spans[1]).not.toHaveProperty("output");
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
        input: "hello",
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

    const body = jsonBody(fetchMock.mock.calls.at(-1)!);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "hello",
      output: "hi",
    });
  });
});
