import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import {
  AGENT_NAME,
  LIST_DOCS_DESCRIPTION,
  MODEL,
  READ_DOC_DESCRIPTION,
  SYSTEM_PROMPT,
  langChainMessagesFromTurn,
  lastMessageText,
  lemmaExampleMetadata,
  listDocs,
  loadExampleEnv,
  readDoc,
  requireOpenAIKey,
  runCli,
  type ChatTurn,
} from "@lemma/examples-shared";
import { langChain } from "@uselemma/tracing";
import { z } from "zod";

loadExampleEnv();
requireOpenAIKey();

const tools = [
  tool(async () => listDocs(), {
    name: "list_docs",
    description: LIST_DOCS_DESCRIPTION,
    schema: z.object({}),
  }),
  tool(async ({ url }: { url: string }) => readDoc(url), {
    name: "read_doc",
    description: READ_DOC_DESCRIPTION,
    schema: z.object({ url: z.string() }),
  }),
];

const agent = createAgent({
  model: new ChatOpenAI({ model: MODEL }),
  tools,
  systemPrompt: SYSTEM_PROMPT,
});

const lemmaHandler = langChain({ agentName: AGENT_NAME });

async function runTurn(turn: ChatTurn): Promise<string> {
  const result = await agent.invoke(
    {
      messages: langChainMessagesFromTurn(turn, (role, content) =>
        role === "user" ? new HumanMessage(content) : new AIMessage(content),
      ),
    },
    {
      callbacks: [lemmaHandler],
      metadata: lemmaExampleMetadata(turn.identity),
    },
  );
  await lemmaHandler.flush();
  return lastMessageText(result.messages);
}

await runCli(runTurn);
