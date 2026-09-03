/**
 * Drive openAIAgents() through the real OpenAI Agents SDK.
 * No network: local Model + mocked ingest.
 * Replaces the default OpenAI trace backend so CI never calls api.openai.com.
 */
import {
  Agent,
  run,
  setTraceProcessors,
  Usage,
  withTrace,
  type Model,
} from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import { openAIAgents } from "./openai-agents";

function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

function scriptedModel(text: string): Model {
  return {
    name: "scripted",
    async getResponse() {
      return {
        usage: new Usage({
          requests: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        }),
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text }],
          },
        ],
      };
    },
    async *getStreamedResponse() {},
  };
}

describe("openAIAgents through real Agents SDK", () => {
  it("run() sends one owned trace", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    setTraceProcessors([processor]);

    const agent = new Agent({
      name: "support-agent",
      instructions: "Be brief.",
      model: scriptedModel("hello from agents"),
    });

    const result = await withTrace(
      "support-agent",
      async () => run(agent, "hi"),
      {
        groupId: "thread-1",
        metadata: { userId: "user-1" },
      },
    );
    await processor.forceFlush();

    expect(String(result.finalOutput ?? "")).toContain("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jsonBody(fetchMock.mock.calls[0]).trace).toMatchObject({
      name: "support-agent",
      thread_id: "thread-1",
      user_id: "user-1",
    });
  });
});
