import { generateText } from "ai";
import { vercelAI } from "@uselemma/tracing";

const lemmaTelemetry = vercelAI({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
});

export async function runVercelAIV6(
  model: Parameters<typeof generateText>[0]["model"],
  userMessage: string,
) {
  const result = await generateText({
    model,
    prompt: userMessage,
    experimental_telemetry: {
      functionId: "support-agent",
      integrations: [lemmaTelemetry],
    },
  });

  return result.text;
}
