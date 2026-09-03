/**
 * Drive LemmaMastraExporter through a real Mastra Agent.generate.
 * No network: MockLanguageModelV3 + mocked ingest.
 */
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Observability } from "@mastra/observability";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ingestFetchMock, jsonBody, LEMMA_PROJECT_ID } from "../test-helpers";
import { LemmaMastraExporter } from "./mastra";

function mockModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}

describe("LemmaMastraExporter through real Mastra", () => {
  it("agent.generate sends one owned trace", async () => {
    const fetchMock = ingestFetchMock();
    const exporter = new LemmaMastraExporter({
      apiKey: "key",
      projectId: LEMMA_PROJECT_ID,
      fetch: fetchMock as typeof fetch,
      agentName: "support-agent",
    });
    const supportAgent = new Agent({
      id: "support-agent",
      name: "support-agent",
      instructions: "Be brief.",
      model: mockModel("hello from mastra"),
    });
    const mastra = new Mastra({
      agents: { supportAgent },
      observability: new Observability({
        configs: {
          default: {
            serviceName: "support-agent",
            exporters: [exporter],
          },
        },
      }),
    });

    const result = await mastra.getAgent("supportAgent").generate("hi", {
      tracingOptions: { metadata: { threadId: "thread-1", userId: "user-1" } },
    });
    await exporter.flush();

    expect(result.text).toBe("hello from mastra");
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
