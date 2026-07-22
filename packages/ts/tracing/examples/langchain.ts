import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { langChain } from "@uselemma/tracing";

const lemmaHandler = langChain({
  agentName: "support-agent",
  threadIdKey: "conversation_id",
  userIdKey: "user_id",
});

export async function callLangChain(
  userMessage: string,
  conversationId: string,
  userId?: string,
) {
  const model = new ChatOpenAI({
    model: "gpt-4o",
    callbacks: [lemmaHandler],
  });

  const response = await model.invoke([new HumanMessage(userMessage)], {
    metadata: {
      conversation_id: conversationId,
      ...(userId ? { user_id: userId } : {}),
    },
  });
  return response.content;
}

export async function shutdownLangChain() {
  await lemmaHandler.shutdown();
}
