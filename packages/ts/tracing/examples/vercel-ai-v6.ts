import { generateText } from "ai";
import { vercelAI } from "@uselemma/tracing";

export async function runVercelAIV6(
  model: Parameters<typeof generateText>[0]["model"],
  userMessage: string,
  options?: {
    threadId?: string;
    userId?: string;
  },
) {
  // Create one integration per AI SDK operation. Concurrent reuse is unsafe
  // because AI SDK terminal events do not carry a reliable run ID.
  const lemmaTelemetry = vercelAI({
    apiKey: process.env.LEMMA_API_KEY,
    projectId: process.env.LEMMA_PROJECT_ID,
  });

  try {
    const result = await generateText({
      model,
      prompt: userMessage,
      experimental_telemetry: {
        functionId: "support-agent",
        metadata: {
          ...(options?.threadId ? { threadId: options.threadId } : {}),
          ...(options?.userId ? { userId: options.userId } : {}),
        },
        integrations: [lemmaTelemetry],
      },
    });
    await lemmaTelemetry.flush();
    return result.text;
  } catch (error) {
    await lemmaTelemetry.fail(error);
    throw error;
  }
}
