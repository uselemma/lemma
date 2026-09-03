/**
 * Drive openAIAgents() through the real OpenAI Agents SDK.
 * No network: local Model + mocked ingest.
 * Replaces the default OpenAI trace backend so CI never calls api.openai.com.
 */
import {
  Agent,
  run,
  setTraceProcessors,
  setTracingDisabled,
  Usage,
  withGenerationSpan,
  withTrace,
  type Model,
} from "@openai/agents";
import { afterEach, describe, expect, it } from "vitest";
import { ingestFetchMock, jsonBody, LEMMA_PROJECT_ID } from "../test-helpers";
import { openAIAgents } from "./openai-agents";

function scriptedModel(text: string): Model {
  return {
    name: "scripted",
    async getResponse() {
      // Custom models do not emit generation spans unless they open one.
      return withGenerationSpan(
        async () => ({
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
        }),
        { data: { type: "generation", model: "scripted" } },
      );
    },
    async *getStreamedResponse() {},
  };
}

describe("openAIAgents through real Agents SDK", () => {
  afterEach(() => {
    setTraceProcessors([]);
    // Restore the SDK's NODE_ENV=test default.
    setTracingDisabled(true);
  });

  it("run() sends one owned trace", async () => {
    const fetchMock = ingestFetchMock();
    const processor = openAIAgents({
      apiKey: "key",
      projectId: LEMMA_PROJECT_ID,
      fetch: fetchMock as typeof fetch,
    });
    // The Agents SDK disables tracing when NODE_ENV=test (vitest).
    setTracingDisabled(false);
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
    const trace = jsonBody(fetchMock.mock.calls[0]).trace;
    expect(trace).toMatchObject({
      name: "support-agent",
      thread_id: "thread-1",
      user_id: "user-1",
    });
    expect(
      trace.spans.some((span: { type: string }) => span.type === "generation"),
    ).toBe(true);
  });
});
