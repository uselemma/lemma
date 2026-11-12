import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { disableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

describe("openAIAgents prompt snapshot", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
  });

  it("stores the prompt once, outside openai.agents.span_data", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const prompt = "PROMPT-BODY-once-history";
    const instructions = "SYSTEM-BODY-once";
    const reply = "OUTPUT-BODY-once";
    const tools = [{ type: "function", name: "lookup_order" }];

    await processor.onTraceStart({
      traceId: "trace_once_prompt",
      name: "support-agent",
    });
    await processor.onSpanEnd({
      traceId: "trace_once_prompt",
      spanId: "span_once",
      spanData: {
        type: "response",
        _input: [{ role: "user", content: prompt }],
        _response: {
          model: "gpt-4.1",
          instructions,
          tools,
          usage: { input_tokens: 12, output_tokens: 4 },
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: reply }],
            },
          ],
        },
      },
    });
    await processor.onTraceEnd({
      traceId: "trace_once_prompt",
      name: "support-agent",
    });
    await processor.forceFlush();

    const span = jsonBody(fetchMock.mock.calls[0]).trace.spans[0];
    const spanData = JSON.parse(span.attributes["openai.agents.span_data"]);
    expect(span.input).toEqual([{ role: "user", content: prompt }]);
    expect(span.output).toBe(reply);
    expect(span.attributes["llm.model_name"]).toBe("gpt-4.1");
    expect(span.attributes["llm.input_messages.1.message.content"]).toBe(
      prompt,
    );
    expect(JSON.parse(span.attributes["llm.tools"])).toEqual(tools);
    expect(span.usage).toMatchObject({
      input_tokens: 12,
      output_tokens: 4,
    });
    expect(spanData._response.model).toBe("gpt-4.1");
    expect(spanData._response.tools).toEqual(tools);
    expect(spanData._response.output).toBeUndefined();
    expect(spanData._response.instructions).toBeUndefined();
    expect(spanData._input).toBeUndefined();
    expect(span.attributes["openai.agents.span_data"]).not.toContain(prompt);
    expect(span.attributes["openai.agents.span_data"]).not.toContain(
      instructions,
    );
    expect(span.attributes["openai.agents.span_data"]).not.toContain(reply);
  });
});
