import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
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
import { langGraph } from "@uselemma/tracing";
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

const model = new ChatOpenAI({ model: MODEL }).bindTools(tools);
const toolNode = new ToolNode(tools);

async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    ...state.messages,
  ]);
  return { messages: [response] };
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const last = state.messages.at(-1);
  if (last instanceof AIMessage && last.tool_calls?.length) {
    return "tools";
  }
  return END;
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();

const lemmaHandler = langGraph({ agentName: AGENT_NAME });

async function runTurn(turn: ChatTurn): Promise<string> {
  const result = await graph.invoke(
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
