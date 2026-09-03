import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import {
  AGENT_NAME,
  LIST_DOCS_DESCRIPTION,
  MODEL,
  READ_DOC_DESCRIPTION,
  SYSTEM_PROMPT,
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

const listDocsTool = tool(async () => listDocs(), {
  name: "list_docs",
  description: LIST_DOCS_DESCRIPTION,
  schema: z.object({}),
});

const readDocTool = tool(
  async ({ url }: { url: string }) => readDoc(url),
  {
    name: "read_doc",
    description: READ_DOC_DESCRIPTION,
    schema: z.object({ url: z.string() }),
  },
);

const lemmaHandler = langChain({
  agentName: AGENT_NAME,
  threadIdKey: "threadId",
  userIdKey: "userId",
});

const model = new ChatOpenAI({
  model: MODEL,
}).bindTools([listDocsTool, readDocTool]);

async function invokeDocsTool(
  name: string,
  args: Record<string, unknown>,
  config: object,
): Promise<string> {
  const output =
    name === "list_docs"
      ? await listDocsTool.invoke({}, config)
      : name === "read_doc"
        ? await readDocTool.invoke({ url: String(args.url ?? "") }, config)
        : null;
  if (output == null) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return typeof output === "string" ? output : JSON.stringify(output);
}

async function runTurn(turn: ChatTurn): Promise<string> {
  const config = {
    callbacks: [lemmaHandler],
    metadata: {
      threadId: turn.identity.threadId,
      ...(turn.identity.userId ? { userId: turn.identity.userId } : {}),
    },
  };

  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    ...turn.history.map((item) =>
      item.role === "user"
        ? new HumanMessage(item.content)
        : new AIMessage(item.content),
    ),
    new HumanMessage(turn.message),
  ];

  for (let step = 0; step < 8; step++) {
    const response = await model.invoke(messages, {
      ...config,
      callbacks: config.callbacks as never,
    });
    messages.push(response);
    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      await lemmaHandler.flush();
      return typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    }
    for (const call of toolCalls) {
      const output = await invokeDocsTool(
        call.name,
        call.args as Record<string, unknown>,
        { ...config, callbacks: config.callbacks as never },
      );
      messages.push(
        new ToolMessage({
          content: output,
          tool_call_id: call.id ?? call.name,
        }),
      );
    }
  }

  await lemmaHandler.flush();
  return "Stopped after the tool-call limit.";
}

await runCli(runTurn);
