import { describe, expect, it, vi } from "vitest";
import { langChain, langGraph } from "./langchain";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("langChain", () => {
  it("records a LangChain run with generation, retriever, and tool children", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const handler = langChain({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    handler.handleChainStart(
      { id: ["langchain", "chains", "RunnableSequence"] },
      { input: "where is my order?" },
      "chain-1",
      undefined,
      undefined,
      { threadId: "thread-1" },
      undefined,
      "support-agent",
    );
    handler.handleLLMStart(
      {
        id: ["langchain", "chat_models", "ChatOpenAI"],
        kwargs: { model: "gpt-4o" },
      },
      ["where is my order?"],
      "llm-1",
      "chain-1",
    );
    handler.handleLLMEnd(
      {
        generations: [[{ text: "I should search docs." }]],
      },
      "llm-1",
    );
    handler.handleRetrieverStart(
      { id: ["langchain", "retrievers", "VectorStoreRetriever"] },
      "order",
      "retriever-1",
      "chain-1",
    );
    handler.handleRetrieverEnd(
      [{ pageContent: "Shipping docs" }],
      "retriever-1",
    );
    handler.handleToolStart(
      { name: "search_docs" },
      { query: "order" },
      "tool-1",
      "chain-1",
    );
    handler.handleToolEnd([{ title: "Shipping" }], "tool-1");
    await handler.handleChainEnd({ answer: "It arrives Friday." }, "chain-1");

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: { input: "where is my order?" },
      output: { answer: "It arrives Friday." },
      metadata: {
        threadId: "thread-1",
        langchainRunId: "chain-1",
      },
    });
    expect(body.trace.spans).toMatchObject([
      {
        name: "ChatOpenAI",
        type: "generation",
        input: ["where is my order?"],
        output: "I should search docs.",
        model: "gpt-4o",
      },
      {
        name: "VectorStoreRetriever",
        type: "span",
        input: "order",
        output: [{ pageContent: "Shipping docs" }],
      },
      {
        name: "search_docs",
        type: "tool",
        input: { query: "order" },
        output: [{ title: "Shipping" }],
      },
    ]);
  });

  it("records errors on child spans and root traces", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const handler = langChain({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    handler.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    handler.handleToolStart({ name: "lookup" }, "hello", "tool-1", "chain-1");
    handler.handleToolError(new Error("lookup failed"), "tool-1");
    await handler.handleChainError(new Error("agent failed"), "chain-1");

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      status: "ERROR",
      error: "agent failed",
    });
    expect(body.trace.spans[0]).toMatchObject({
      name: "lookup",
      type: "tool",
      status: "ERROR",
      error: "lookup failed",
    });
  });
});

describe("langGraph", () => {
  it("uses LangGraph callback events with a LangGraph default trace name", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const handler = langGraph({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    handler.handleChainStart(
      { name: "StateGraph" },
      { topic: "docs" },
      "graph-1",
    );
    handler.handleChainStart(
      { name: "retrieve" },
      { topic: "docs" },
      "node-1",
      "graph-1",
    );
    await handler.handleChainEnd({ docs: ["one"] }, "node-1");
    await handler.handleChainEnd({ answer: "done" }, "graph-1");

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "langgraph-agent",
      input: { topic: "docs" },
      output: { answer: "done" },
    });
    expect(body.trace.spans[0]).toMatchObject({
      name: "retrieve",
      type: "span",
      input: { topic: "docs" },
      output: { docs: ["one"] },
    });
  });
});
