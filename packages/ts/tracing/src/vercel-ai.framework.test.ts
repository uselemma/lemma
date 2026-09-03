/**
 * Drive vercelAI() through real AI SDK generateText.
 * No network: MockLanguageModelV3 + mocked ingest.
 */
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ingestFetchMock, jsonBody, LEMMA_PROJECT_ID } from "../test-helpers";
import { vercelAI } from "./vercel-ai";

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

describe("vercelAI through real AI SDK", () => {
  it("generateText sends one owned trace", async () => {
    const fetchMock = ingestFetchMock();
    const lemmaTelemetry = vercelAI({
      apiKey: "key",
      projectId: LEMMA_PROJECT_ID,
      fetch: fetchMock as typeof fetch,
      metadata: { threadId: "thread-1", userId: "user-1" },
    });

    const result = await generateText({
      model: mockModel("hello from vercel ai"),
      prompt: "hi",
      telemetry: {
        isEnabled: true,
        functionId: "support-agent",
        integrations: [lemmaTelemetry],
      },
    });
    await lemmaTelemetry.flush();

    expect(result.text).toBe("hello from vercel ai");
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
