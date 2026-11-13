import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { disableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

describe("openAIAgents history roles", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
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

  it("keeps a non-object response value as the span output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({ traceId: "trace_raw", name: "agent" });
    await processor.onSpanEnd({
      traceId: "trace_raw",
      spanId: "span_raw",
      spanData: { type: "response", response: "raw-response-text" },
    });
    await processor.onTraceEnd({ traceId: "trace_raw", name: "agent" });
    await processor.forceFlush();

    expect(jsonBody(fetchMock.mock.calls[0]).trace.spans[0].output).toBe(
      "raw-response-text",
    );
  });
});
