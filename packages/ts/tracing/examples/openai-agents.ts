import { Agent, addTraceProcessor, run } from "@openai/agents";
import { openAIAgents } from "@uselemma/tracing";

const processor = openAIAgents({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
  metadata: { service: "support" },
});

addTraceProcessor(processor);

const agent = new Agent({
  name: "support-agent",
  instructions: "Answer customer questions clearly and concisely.",
});

const result = await run(agent, "Where is my order?", {
  // OpenAI Agents groupId becomes Lemma thread_id.
});

console.log(result.finalOutput);
await processor.forceFlush();
