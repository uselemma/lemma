import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { langChain } from "@uselemma/tracing";

const lemmaCallbacks = [langChain({ agentName: "support-agent" })];

export async function callLangChain(userMessage: string) {
  const model = new ChatOpenAI({
    model: "gpt-4o",
    callbacks: lemmaCallbacks,
  });

  const response = await model.invoke([new HumanMessage(userMessage)]);
  return response.content;
}
