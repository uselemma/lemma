import {
  AGENT_NAME,
  LIST_DOCS_DESCRIPTION,
  MODEL,
  READ_DOC_DESCRIPTION,
  SYSTEM_PROMPT,
  listDocs,
  loadExampleEnv,
  modelMessages,
  readDoc,
  requireOpenAIKey,
  runCli,
  type ChatTurn,
} from "@lemma/examples-shared";
import { Agent, addTraceProcessor, assistant, run, tool, user, withTrace } from "@openai/agents";
import { openAIAgents } from "@uselemma/tracing";
import { z } from "zod";

loadExampleEnv();
requireOpenAIKey();

const processor = openAIAgents();
addTraceProcessor(processor);

const agent = new Agent({
  name: AGENT_NAME,
  instructions: SYSTEM_PROMPT,
  model: MODEL,
  tools: [
    tool({
      name: "list_docs",
      description: LIST_DOCS_DESCRIPTION,
      parameters: z.object({}),
      execute: async () => listDocs(),
    }),
    tool({
      name: "read_doc",
      description: READ_DOC_DESCRIPTION,
      parameters: z.object({ url: z.string() }),
      execute: async ({ url }) => readDoc(url),
    }),
  ],
});

async function runTurn(turn: ChatTurn): Promise<string> {
  const input = modelMessages(turn).map((item) =>
    item.role === "user" ? user(item.content) : assistant(item.content),
  );
  const result = await withTrace(
    AGENT_NAME,
    async () => run(agent, input),
    {
      groupId: turn.identity.threadId,
      metadata: turn.identity.userId ? { userId: turn.identity.userId } : {},
    },
  );
  await processor.forceFlush();
  return String(result.finalOutput ?? "");
}

await runCli(runTurn);
