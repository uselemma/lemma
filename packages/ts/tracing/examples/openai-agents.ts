import { Agent, addTraceProcessor, run } from "@openai/agents";
import { openAIAgents } from "@uselemma/tracing";

addTraceProcessor(openAIAgents());

const agent = new Agent({
  name: "support-agent",
  instructions: "Answer customer questions clearly and concisely.",
});

const result = await run(agent, "Where is my order?");

console.log(result.finalOutput);
