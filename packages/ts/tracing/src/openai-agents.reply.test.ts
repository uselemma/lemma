import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { disableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

describe("openAIAgents reply text", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
  });

  it("stores streamed Responses reply text and an AI SDK chat turn", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_reply",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_reply",
      spanId: "span_reply",
      spanData: {
        type: "response",
        input: [{ role: "user", content: "where is my order?" }],
        _response: {
          model: "gpt-4.1",
          output: [
            {
              type: "reasoning",
              encrypted_content: "gAAAA-secret-blob",
              summary: [],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "It arrives Friday." }],
            },
          ],
        },
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_reply",
      name: "support-agent",
    });
    await processor.forceFlush();

    const streamed = jsonBody(fetchMock.mock.calls[0]);
    expect(streamed.trace.output).toBe("It arrives Friday.");
    expect(streamed.trace.spans[0].output).toBe("It arrives Friday.");

    await processor.onTraceStart({
      traceId: "trace_chat",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_chat",
      spanId: "span_chat",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "status?" }],
        output: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "checking the shipment" },
              { type: "text", text: "Ships Friday." },
            ],
          },
        ],
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_chat",
      name: "support-agent",
    });
    await processor.forceFlush();

    const chat = jsonBody(fetchMock.mock.calls[1]);
    expect(chat.trace.output).toBe("Ships Friday.");
    expect(chat.trace.spans[0].output).toBe("Ships Friday.");
  });
});
