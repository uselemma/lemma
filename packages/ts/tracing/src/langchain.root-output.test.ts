import { describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { langChain } from "./langchain";

const PROJECT_ID = "10000000-0000-0000-0000-000000000001";

const bedrockReasoningBlocks = [
  {
    type: "reasoning_content",
    reasoning_content: { text: "internal chain of thought" },
  },
  { type: "text", text: "Your cortisol is elevated." },
];

function handler(fetchMock: ReturnType<typeof vi.fn>) {
  return langChain({
    apiKey: "key",
    projectId: PROJECT_ID,
    fetch: fetchMock as typeof fetch,
  });
}

describe("langChain root trace.output", () => {
  it("flattens Bedrock reasoning_content + text blocks for root output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart(
      { name: "agent" },
      { messages: [{ type: "human", content: "hi" }] },
      "root",
      undefined,
      undefined,
      { thread_id: "t" },
    );
    h.handleLLMStart(
      {
        id: [
          "langchain_aws",
          "chat_models",
          "bedrock_converse",
          "ChatBedrockConverse",
        ],
        kwargs: { model: "claude-sonnet-4" },
      },
      [[{ type: "human", content: "hi" }]],
      "llm-1",
      "root",
    );
    await h.handleLLMEnd(
      {
        generations: [
          [{ message: { type: "ai", content: bedrockReasoningBlocks } }],
        ],
      },
      "llm-1",
    );
    await h.handleChainEnd(
      {
        messages: [
          { type: "human", content: "hi" },
          { type: "ai", content: bedrockReasoningBlocks },
        ],
      },
      "root",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.output).toBe("Your cortisol is elevated.");
    expect(body.trace.spans[0].output).toEqual(bedrockReasoningBlocks);
  });

  it("flattens thinking / reasoning lists and dict fallbacks", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "agent" }, "hi", "chain-thinking");
    await h.handleChainEnd(
      {
        messages: [
          {
            type: "ai",
            content: [
              { type: "thinking", thinking: "let me think" },
              { type: "text", text: "Done." },
            ],
          },
        ],
      },
      "chain-thinking",
    );

    h.handleChainStart({ name: "agent" }, "hi", "chain-answer");
    await h.handleChainEnd({ answer: bedrockReasoningBlocks }, "chain-answer");

    h.handleChainStart({ name: "agent" }, "hi", "chain-nested");
    await h.handleChainEnd(
      { result: { content: bedrockReasoningBlocks } },
      "chain-nested",
    );

    h.handleChainStart({ name: "agent" }, "hi", "chain-tools");
    await h.handleChainEnd(
      {
        role: "assistant",
        content: bedrockReasoningBlocks,
        tool_calls: [{ id: "call_1", name: "lookup", args: {} }],
      },
      "chain-tools",
    );

    await h.flush();
    expect(jsonBody(fetchMock.mock.calls[0]).trace.output).toBe("Done.");
    expect(jsonBody(fetchMock.mock.calls[1]).trace.output).toBe(
      "Your cortisol is elevated.",
    );
    expect(jsonBody(fetchMock.mock.calls[2]).trace.output).toBe(
      "Your cortisol is elevated.",
    );
    expect(jsonBody(fetchMock.mock.calls[3]).trace.output).toEqual({
      role: "assistant",
      content: bedrockReasoningBlocks,
      tool_calls: [{ id: "call_1", name: "lookup", args: {} }],
    });
  });
});
