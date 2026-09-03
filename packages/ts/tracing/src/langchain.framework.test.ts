/**
 * Drive Lemma's LangChain handler through real LangChain / LangGraph.
 * No network: FakeListChatModel + mocked ingest.
 */
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { RunnableLambda } from "@langchain/core/runnables";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ingestFetchMock,
  jsonBody,
  langChainCallbacks,
  LEMMA_PROJECT_ID,
} from "../test-helpers";
import { langChain, langGraph } from "./langchain";

function handler(
  fetchMock: ReturnType<typeof ingestFetchMock>,
  options: Record<string, unknown> = {},
) {
  return langChain({
    apiKey: "key",
    projectId: LEMMA_PROJECT_ID,
    fetch: fetchMock as typeof fetch,
    ...options,
  });
}

describe("langChain through real LangChain", () => {
  it("accepts the handler on model.invoke and sends one trace", async () => {
    const fetchMock = ingestFetchMock();
    const h = handler(fetchMock, { agentName: "support-agent" });
    const model = new FakeListChatModel({ responses: ["hello from model"] });

    const result = await model.invoke([new HumanMessage("hi")], {
      callbacks: langChainCallbacks(h),
      metadata: { threadId: "thread-1", userId: "user-1" },
    });
    await h.flush();

    expect(result.content).toBe("hello from model");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonBody(fetchMock.mock.calls[0]).trace).toMatchObject({
      name: "support-agent",
      thread_id: "thread-1",
      user_id: "user-1",
    });
  });

  it("createAgent.invoke is one root", async () => {
    const fetchMock = ingestFetchMock();
    const h = handler(fetchMock, { agentName: "support-agent" });
    const agent = createAgent({
      model: new FakeListChatModel({ responses: ["pong from docs"] }),
      tools: [],
      systemPrompt: "Be brief.",
    });

    const result = await agent.invoke(
      { messages: [new HumanMessage("ping")] },
      {
        callbacks: langChainCallbacks(h),
        metadata: { threadId: "thread-1", userId: "user-1" },
      },
    );
    await h.flush();

    const last = result.messages.at(-1);
    const content = last && "content" in last ? last.content : "";
    expect(content).toBe("pong from docs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonBody(fetchMock.mock.calls[0]).trace).toMatchObject({
      name: "support-agent",
      thread_id: "thread-1",
      user_id: "user-1",
    });
  });

  it("nests a real tool.invoke under one parent chain root", async () => {
    const fetchMock = ingestFetchMock();
    const h = handler(fetchMock, { agentName: "support-agent" });
    const ping = tool(async () => "pong", {
      name: "ping",
      description: "Return pong",
      schema: z.object({}),
    });
    const chain = RunnableLambda.from(async (_input, config) =>
      ping.invoke({}, config),
    );

    const result = await chain.invoke(
      {},
      {
        callbacks: langChainCallbacks(h),
        metadata: { threadId: "thread-1" },
      },
    );
    await h.flush();

    expect(result).toBe("pong");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const trace = jsonBody(fetchMock.mock.calls[0]).trace;
    expect(trace).toMatchObject({
      name: "support-agent",
      thread_id: "thread-1",
    });
    expect(
      trace.spans.some((span: { type: string }) => span.type === "tool"),
    ).toBe(true);
  });
});

describe("langGraph through real LangGraph", () => {
  it("graph.invoke is one root with a nested generation", async () => {
    const fetchMock = ingestFetchMock();
    const h = langGraph({
      apiKey: "key",
      projectId: LEMMA_PROJECT_ID,
      fetch: fetchMock as typeof fetch,
      agentName: "support-graph",
    });
    const model = new FakeListChatModel({ responses: ["graph hello"] });

    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => ({
        messages: [await model.invoke(state.messages)],
      }))
      .addEdge(START, "agent")
      .addEdge("agent", END)
      .compile();

    const result = await graph.invoke(
      { messages: [new HumanMessage("hi")] },
      {
        callbacks: langChainCallbacks(h),
        metadata: { threadId: "thread-9" },
      },
    );
    await h.flush();

    const last = result.messages.at(-1);
    const content = last && "content" in last ? last.content : "";
    expect(content).toBe("graph hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const trace = jsonBody(fetchMock.mock.calls[0]).trace;
    expect(trace).toMatchObject({
      name: "support-graph",
      thread_id: "thread-9",
    });
    expect(
      trace.spans.some((span: { type: string }) => span.type === "generation"),
    ).toBe(true);
  });
});
