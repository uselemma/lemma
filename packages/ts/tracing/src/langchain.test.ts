import { describe, expect, it, vi } from "vitest";
import { langChain, langGraph } from "./langchain";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

function handler(fetchMock: ReturnType<typeof vi.fn>, options: Record<string, unknown> = {}) {
  return langChain({
    apiKey: "key",
    projectId: "10000000-0000-0000-0000-000000000001",
    fetch: fetchMock as typeof fetch,
    ...options,
  });
}

describe("langChain", () => {
  it("records a LangChain run with generation, retriever, and tool children", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart(
      { id: ["langchain", "chains", "RunnableSequence"] },
      { input: "where is my order?" },
      "chain-1",
      undefined,
      undefined,
      { threadId: "thread-1", userId: "user-1" },
      undefined,
      "support-agent",
    );
    h.handleLLMStart(
      {
        id: ["langchain", "chat_models", "openai", "ChatOpenAI"],
        kwargs: { model: "gpt-4o" },
      },
      ["where is my order?"],
      "llm-1",
      "chain-1",
    );
    await h.handleLLMEnd(
      {
        generations: [[{ text: "I should search docs." }]],
      },
      "llm-1",
    );
    h.handleRetrieverStart(
      { id: ["langchain", "retrievers", "VectorStoreRetriever"] },
      "order",
      "retriever-1",
      "chain-1",
    );
    await h.handleRetrieverEnd(
      [{ pageContent: "Shipping docs" }],
      "retriever-1",
    );
    h.handleToolStart(
      { name: "search_docs" },
      { query: "order" },
      "tool-1",
      "chain-1",
    );
    await h.handleToolEnd([{ title: "Shipping" }], "tool-1");
    await h.handleChainEnd({ answer: "It arrives Friday." }, "chain-1");

    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "support-agent",
      input: "where is my order?",
      output: "It arrives Friday.",
      thread_id: "thread-1",
      user_id: "user-1",
      metadata: {
        threadId: "thread-1",
        userId: "user-1",
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
        attributes: {
          "llm.provider": "openai",
        },
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
        tool_name: "search_docs",
      },
    ]);
    expect(body.trace.spans[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(body.trace.spans[2].duration_ms).toBeGreaterThanOrEqual(0);
    expect(body.trace.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("finalizes a standalone chat model as exactly one owned trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChatModelStart(
      {
        id: ["langchain_openai", "chat_models", "ChatOpenAI"],
        kwargs: { model: "gpt-4o-mini" },
      },
      [
        [
          { type: "system", content: "Be brief." },
          { type: "human", content: "hello" },
        ],
      ],
      "llm-solo",
      undefined,
      { temperature: 0 },
      undefined,
      { conversation_id: "conv-9", customer_id: "cust-3" },
    );
    await h.handleLLMEnd(
      {
        generations: [
          [
            {
              message: {
                type: "ai",
                content: "hi there",
                tool_calls: [{ id: "call_1", name: "noop", args: {} }],
              },
            },
          ],
        ],
      },
      "llm-solo",
    );
    // Owned LLM ends with tool_calls defer finalize until flush / final answer.
    await h.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "ChatOpenAI",
      input: "hello",
      output: {
        role: "assistant",
        content: "hi there",
        tool_calls: [{ id: "call_1", name: "noop", args: {} }],
      },
      thread_id: "conv-9",
    });
    expect(body.trace.spans).toHaveLength(1);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      model: "gpt-4o-mini",
      attributes: { "llm.provider": "openai" },
      input: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hello" },
      ],
      output: {
        role: "assistant",
        content: "hi there",
        tool_calls: [{ id: "call_1", name: "noop", args: {} }],
      },
    });
  });

  it("emits usage, provider, and provenance from llmOutput.tokenUsage", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleLLMStart(
      {
        id: ["langchain_openai", "chat_models", "ChatOpenAI"],
        kwargs: { model: "gpt-4o" },
      },
      ["hello"],
      "llm-usage",
    );
    await h.handleLLMEnd(
      {
        generations: [[{ text: "hi" }]],
        llmOutput: {
          tokenUsage: {
            promptTokens: 12,
            completionTokens: 3,
            totalTokens: 15,
          },
        },
      },
      "llm-usage",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      model: "gpt-4o",
      usage: { input_tokens: 12, output_tokens: 3 },
      attributes: {
        "llm.provider": "openai",
        "gen_ai.system": "openai",
        "gen_ai.usage.input_tokens": 12,
        "gen_ai.usage.output_tokens": 3,
        "llm.token_count.prompt": 12,
        "llm.token_count.completion": 3,
        "lemma.sdk.language": "typescript",
        "lemma.sdk.integration": "langchain",
      },
    });
  });

  it("emits explicit zero usage from message usage_metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChatModelStart(
      {
        id: ["langchain_anthropic", "chat_models", "ChatAnthropic"],
        kwargs: { model: "claude-3-5-sonnet" },
      },
      [[{ type: "human", content: "ping" }]],
      "llm-zero",
    );
    await h.handleLLMEnd(
      {
        generations: [
          [
            {
              message: {
                type: "ai",
                content: "pong",
                usage_metadata: {
                  input_tokens: 0,
                  output_tokens: 0,
                  cache_read_input_tokens: 0,
                },
              },
            },
          ],
        ],
      },
      "llm-zero",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      },
      attributes: {
        "llm.provider": "anthropic",
        "gen_ai.usage.input_tokens": 0,
        "gen_ai.usage.output_tokens": 0,
      },
    });
  });

  it("stamps invoke result usage when the LLM end event omits it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleLLMStart(
      { id: ["langchain", "chat_models", "openai", "ChatOpenAI"] },
      ["hi"],
      "llm-result-usage",
    );
    await h.handleLLMEnd(
      { generations: [[{ text: "hello" }]] },
      "llm-result-usage",
    );
    expect(
      h.recordResult({
        usage_metadata: { input_tokens: 9, output_tokens: 3 },
      }),
    ).toBe(1);
    await h.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      usage: { input_tokens: 9, output_tokens: 3 },
    });
  });

  it("stamps response_metadata.model_name onto the generation when start omits model", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChatModelStart(
      {
        id: ["langchain", "chat_models", "fake", "FakeMessagesListChatModel"],
        name: "FakeMessagesListChatModel",
        kwargs: { responses: [{ type: "ai", content: "It arrives Friday." }] },
      },
      [[{ type: "human", content: "where is my order?" }]],
      "llm-fake",
    );
    await h.handleLLMEnd(
      {
        generations: [
          [
            {
              text: "It arrives Friday.",
              message: {
                type: "ai",
                content: "It arrives Friday.",
                response_metadata: { model_name: "gpt-4o-mini" },
              },
            },
          ],
        ],
      },
      "llm-fake",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      model: "gpt-4o-mini",
      attributes: {
        "llm.model_name": "gpt-4o-mini",
        "gen_ai.request.model": "gpt-4o-mini",
        "ai.model.id": "gpt-4o-mini",
      },
    });
  });

  it("omits usage when the provider did not supply token counts", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleLLMStart(
      { id: ["langchain", "chat_models", "openai", "ChatOpenAI"] },
      ["hi"],
      "llm-no-usage",
    );
    await h.handleLLMEnd(
      { generations: [[{ text: "hello" }]] },
      "llm-no-usage",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).not.toHaveProperty("usage");
    expect(body.trace.spans[0].attributes).not.toHaveProperty(
      "gen_ai.usage.input_tokens",
    );
  });

  it("promotes configurable conversation/user identity keys", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock, {
      threadIdKey: "conversation_id",
      userIdKey: "customer_id",
    });

    h.handleChainStart(
      { name: "agent" },
      "hi",
      "chain-1",
      undefined,
      ["conversation_id:from-tag"],
      { conversation_id: "conv-meta", customer_id: "cust-meta", userId: "ignored" },
    );
    await h.handleChainEnd("ok", "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.thread_id).toBe("conv-meta");
    expect(body.trace.user_id).toBe("cust-meta");
  });

  it("isolates concurrent roots and does not leak missing-parent events", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "a" }, "one", "chain-a");
    h.handleChainStart({ name: "b" }, "two", "chain-b");
    // Orphan parent id must not steal chain-a's or chain-b's state.
    h.handleLLMStart(
      { id: ["langchain", "chat_models", "openai", "ChatOpenAI"], kwargs: { model: "gpt-4o" } },
      ["orphan"],
      "llm-orphan",
      "missing-parent",
    );
    await h.handleLLMEnd(
      { generations: [[{ text: "orphan-out" }]] },
      "llm-orphan",
    );
    await h.handleChainEnd("out-a", "chain-a");
    await h.handleChainEnd("out-b", "chain-b");

    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const traces = fetchMock.mock.calls.map((call) => jsonBody(call).trace);
    const byName = Object.fromEntries(traces.map((t: { name: string }) => [t.name, t]));
    expect(byName.a).toMatchObject({ input: "one", output: "out-a" });
    expect(byName.b).toMatchObject({ input: "two", output: "out-b" });
    expect(byName.a.spans ?? []).toHaveLength(0);
    expect(byName.b.spans ?? []).toHaveLength(0);
    expect(byName.ChatOpenAI).toMatchObject({
      input: "orphan",
      output: "orphan-out",
    });
    expect(byName.ChatOpenAI.spans).toHaveLength(1);
  });

  it("records errors on child spans and root traces", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    h.handleToolStart({ name: "lookup" }, "hello", "tool-1", "chain-1");
    await h.handleToolError(new Error("lookup failed"), "tool-1");
    await h.handleChainError(new Error("agent failed"), "chain-1");

    await h.flush();
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
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("fails the root even when the exception carries no message", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    h.handleToolStart({ name: "lookup" }, "hello", "tool-1", "chain-1");
    await h.handleToolError(new RangeError(), "tool-1");
    await h.handleChainError(new Error(), "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({ status: "ERROR", error: "Error" });
    expect(body.trace.spans[0]).toMatchObject({
      name: "lookup",
      status: "ERROR",
      error: "RangeError",
    });
  });

  it("qualifies subclass exceptions with their class name", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    await h.handleChainError(new TypeError("x is not a function"), "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      status: "ERROR",
      error: "TypeError: x is not a function",
    });
  });

  it("records MCP isError tool ends as error without output", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    h.handleToolStart(
      { name: "pdf_server_pdf" },
      { query: "YAT" },
      "tool-1",
      "chain-1",
    );
    await h.handleToolEnd(
      {
        content: [
          { type: "text", text: "Internal error: Validation error" },
        ],
        isError: true,
      },
      "tool-1",
    );
    await h.handleChainEnd({ ok: true }, "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "pdf_server_pdf",
      type: "tool",
      status: "ERROR",
      error: "Internal error: Validation error",
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("records MCP isError:false payloads with structuredContent.error as span errors", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "support-agent" }, "hello", "chain-1");
    h.handleToolStart(
      { name: "return_delivered_order_items" },
      { order_id: "#W-001" },
      "tool-1",
      "chain-1",
    );
    await h.handleToolEnd(
      {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Error: Payment method not found" }),
          },
        ],
        structuredContent: { error: "Error: Payment method not found" },
      },
      "tool-1",
    );
    await h.handleChainEnd({ ok: true }, "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "return_delivered_order_items",
      type: "tool",
      status: "ERROR",
      error: "Error: Payment method not found",
    });
    expect(body.trace.spans[0]).not.toHaveProperty("output");
  });

  it("records inputs, outputs, errors, and structure", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart(
      { name: "agent" },
      { input: "secret" },
      "chain-1",
      undefined,
      undefined,
      { threadId: "t1", userId: "u1" },
    );
    h.handleLLMStart(
      { id: ["langchain", "chat_models", "openai", "ChatOpenAI"], kwargs: { model: "gpt-4o" } },
      ["secret"],
      "llm-1",
      "chain-1",
    );
    await h.handleLLMEnd({ generations: [[{ text: "secret-out" }]] }, "llm-1");
    h.handleToolStart({ name: "lookup" }, { q: "secret" }, "tool-1", "chain-1");
    await h.handleToolError(new Error("boom"), "tool-1");
    await h.handleChainError(new Error("failed"), "chain-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "agent",
      status: "ERROR",
      thread_id: "t1",
      user_id: "u1",
    });
    expect(body.trace.input).toBe("secret");
    expect(body.trace.error).toBe("failed");
    expect(body.trace.spans[0]).toMatchObject({
      type: "generation",
      model: "gpt-4o",
      input: ["secret"],
      output: "secret-out",
    });
    expect(body.trace.spans[1]).toMatchObject({
      type: "tool",
      status: "ERROR",
      error: "boom",
      input: { q: "secret" },
    });
    expect(body.trace.spans[1]).not.toHaveProperty("output");
  });

  it("normalizes common LangChain message classes and preserves tool calls", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    class HumanMessage {
      constructor(public content: string) {}
      getType() {
        return "human";
      }
    }
    class AIMessage {
      constructor(
        public content: string,
        public tool_calls: unknown[],
      ) {}
      getType() {
        return "ai";
      }
    }
    class SystemMessage {
      constructor(public content: string) {}
      getType() {
        return "system";
      }
    }
    class ToolMessage {
      constructor(
        public content: string,
        public tool_call_id: string,
      ) {}
      getType() {
        return "tool";
      }
    }

    h.handleChatModelStart(
      { name: "ChatAnthropic", id: ["langchain_anthropic", "chat_models", "ChatAnthropic"], kwargs: { model: "claude-3" } },
      [
        [
          new SystemMessage("sys"),
          new HumanMessage("ask"),
          new AIMessage("prior", [{ id: "c0", name: "x", args: {} }]),
          new ToolMessage("tool-result", "c0"),
        ],
      ],
      "llm-1",
    );
    await h.handleLLMEnd(
      {
        generations: [
          [
            {
              message: new AIMessage("done", [
                { id: "c1", name: "search", args: { q: "1" } },
              ]),
            },
          ],
        ],
      },
      "llm-1",
    );
    await h.flush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.spans[0]).toMatchObject({
      attributes: { "llm.provider": "anthropic" },
      model: "claude-3",
      input: [
        { role: "system", content: "sys" },
        { role: "user", content: "ask" },
        {
          role: "assistant",
          content: "prior",
          tool_calls: [{ id: "c0", name: "x", args: {} }],
        },
        { role: "tool", content: "tool-result", tool_call_id: "c0" },
      ],
      output: {
        role: "assistant",
        content: "done",
        tool_calls: [{ id: "c1", name: "search", args: { q: "1" } }],
      },
    });
  });

  it("keeps an owned LLM open for tools when the generation has tool_calls", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChatModelStart(
      { name: "ChatOpenAI", id: ["langchain_openai", "ChatOpenAI"] },
      [[{ type: "human", content: "lookup" }]],
      "llm-1",
    );
    await h.handleLLMEnd(
      {
        generations: [
          [
            {
              message: {
                type: "ai",
                content: "",
                tool_calls: [{ id: "c1", name: "search", args: { q: "1" } }],
              },
            },
          ],
        ],
      },
      "llm-1",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    h.handleToolStart(
      { name: "search" },
      { q: "1" },
      "tool-1",
      "llm-1",
    );
    await h.handleToolEnd({ ok: true }, "tool-1");
    h.handleChatModelStart(
      { name: "ChatOpenAI", id: ["langchain_openai", "ChatOpenAI"] },
      [[{ type: "human", content: "lookup" }]],
      "llm-2",
      "llm-1",
    );
    await h.handleLLMEnd(
      {
        generations: [[{ message: { type: "ai", content: "found it" } }]],
      },
      "llm-2",
    );

    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      input: "lookup",
      output: "found it",
    });
    expect(body.trace.spans.map((s: { type: string }) => s.type)).toEqual([
      "generation",
      "tool",
      "generation",
    ]);
  });

  it("flush finalizes open traces once and shutdown does not resend", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleChainStart({ name: "open" }, "hi", "chain-1");
    h.handleLLMStart(
      { id: ["langchain", "chat_models", "openai", "ChatOpenAI"], kwargs: { model: "gpt-4o" } },
      ["hi"],
      "llm-1",
      "chain-1",
    );
    await h.handleLLMEnd({ generations: [[{ text: "partial" }]] }, "llm-1");

    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonBody(fetchMock.mock.calls[0]).trace).toMatchObject({
      name: "open",
      input: "hi",
      output: "partial",
    });

    await h.handleChainEnd("late", "chain-1");
    await h.shutdown();
    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attaches children with unknown parents as root-level spans of a new owned trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock);

    h.handleToolStart({ name: "solo-tool" }, { q: 1 }, "tool-1", "ghost-parent");
    await h.handleToolEnd({ ok: true }, "tool-1");

    await h.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace.name).toBe("solo-tool");
    expect(body.trace.spans[0]).toMatchObject({
      name: "solo-tool",
      type: "tool",
      output: { ok: true },
    });
    expect(body.trace.spans[0].parent_id ?? null).toBeNull();
  });

  it("forwards release onto the ingest payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = handler(fetchMock, { release: "1.8.3" });

    h.handleChainStart(
      { id: ["langchain", "chains", "RunnableSequence"] },
      { input: "hi" },
      "chain-1",
    );
    await h.handleChainEnd({ answer: "ok" }, "chain-1");

    await h.flush();
    expect(jsonBody(fetchMock.mock.calls[0]).trace.release).toBe("1.8.3");
  });
});

describe("langGraph", () => {
  it("uses LangGraph callback events with a LangGraph default trace name", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = langGraph({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    h.handleChainStart(
      { name: "StateGraph" },
      { topic: "docs" },
      "graph-1",
    );
    h.handleChainStart(
      { name: "retrieve" },
      { topic: "docs" },
      "node-1",
      "graph-1",
    );
    await h.handleChainEnd({ docs: ["one"] }, "node-1");
    h.handleChainStart(
      { name: "answer" },
      { docs: ["one"] },
      "node-2",
      "graph-1",
    );
    h.handleChatModelStart(
      {
        id: ["langchain", "chat_models", "openai", "ChatOpenAI"],
        kwargs: { model: "gpt-4o" },
      },
      [[{ type: "human", content: "summarize docs" }]],
      "llm-1",
      "node-2",
    );
    await h.handleLLMEnd(
      { generations: [[{ text: "done summary" }]] },
      "llm-1",
    );
    await h.handleChainEnd({ answer: "done" }, "node-2");
    await h.handleChainEnd({ answer: "done" }, "graph-1");

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "langgraph-agent",
      input: { topic: "docs" },
      output: "done",
    });
    expect(body.trace.spans.map((s: { name: string }) => s.name)).toEqual([
      "retrieve",
      "answer",
      "ChatOpenAI",
    ]);
    expect(body.trace.spans[0]).toMatchObject({
      name: "retrieve",
      type: "span",
      input: { topic: "docs" },
      output: { docs: ["one"] },
    });
    expect(body.trace.spans[2]).toMatchObject({
      type: "generation",
      parent_id: body.trace.spans[1].id,
      attributes: { "llm.provider": "openai" },
    });
  });

  it("extracts current-turn input from graph message state", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = langGraph({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      threadIdKey: "thread_id",
    });

    h.handleChainStart(
      { name: "StateGraph" },
      {
        messages: [
          { type: "human", content: "first" },
          { type: "ai", content: "ack" },
          { type: "human", content: "second turn" },
        ],
      },
      "graph-1",
      undefined,
      undefined,
      { thread_id: "tg-1" },
    );
    await h.handleChainEnd(
      {
        messages: [
          { type: "human", content: "second turn" },
          { type: "ai", content: "final answer" },
        ],
      },
      "graph-1",
    );

    await h.flush();
    const body = jsonBody(fetchMock.mock.calls[0]);
    expect(body.trace).toMatchObject({
      name: "langgraph-agent",
      input: "second turn",
      output: "final answer",
      thread_id: "tg-1",
    });
  });

  it("forwards release onto the ingest payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const h = langGraph({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
      release: "1.8.3",
    });

    h.handleChainStart({ name: "StateGraph" }, { topic: "docs" }, "graph-1");
    await h.handleChainEnd({ answer: "done" }, "graph-1");

    await h.flush();
    expect(jsonBody(fetchMock.mock.calls[0]).trace.release).toBe("1.8.3");
  });
});
