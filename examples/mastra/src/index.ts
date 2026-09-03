import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { createTool } from "@mastra/core/tools";
import { Observability } from "@mastra/observability";
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
import { LemmaMastraExporter } from "@uselemma/tracing";
import { z } from "zod";

loadExampleEnv();
requireOpenAIKey();

const lemmaExporter = new LemmaMastraExporter({ agentName: AGENT_NAME });

const listDocsTool = createTool({
  id: "list_docs",
  description: LIST_DOCS_DESCRIPTION,
  inputSchema: z.object({}),
  execute: async () => listDocs(),
});

const readDocTool = createTool({
  id: "read_doc",
  description: READ_DOC_DESCRIPTION,
  inputSchema: z.object({ url: z.string() }),
  execute: async (input: { url: string }) => readDoc(input.url),
});

const docsAgent = new Agent({
  id: AGENT_NAME,
  name: AGENT_NAME,
  instructions: SYSTEM_PROMPT,
  model: `openai/${MODEL}`,
  tools: {
    list_docs: listDocsTool,
    read_doc: readDocTool,
  },
});

const mastra = new Mastra({
  agents: { docsAgent },
  observability: new Observability({
    configs: {
      default: {
        serviceName: AGENT_NAME,
        exporters: [lemmaExporter as never],
      },
    },
  }),
});

async function runTurn(turn: ChatTurn): Promise<string> {
  const agent = mastra.getAgent("docsAgent");
  const result = await agent.generate(
    modelMessages(turn).map(({ role, content }) => ({ role, content })) as never,
    {
      tracingOptions: {
        metadata: {
          threadId: turn.identity.threadId,
          ...(turn.identity.userId ? { userId: turn.identity.userId } : {}),
        },
      },
    },
  );
  await lemmaExporter.flush();
  return result.text;
}

await runCli(runTurn);
