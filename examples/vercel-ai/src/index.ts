import { openai } from "@ai-sdk/openai";
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
import { vercelAI } from "@uselemma/tracing";
import { generateText, stepCountIs, tool, type Telemetry } from "ai";
import { z } from "zod";

loadExampleEnv();
requireOpenAIKey();

async function runTurn(turn: ChatTurn): Promise<string> {
  const lemmaTelemetry = vercelAI({
    metadata: {
      threadId: turn.identity.threadId,
      ...(turn.identity.userId ? { userId: turn.identity.userId } : {}),
    },
  });
  const result = await generateText({
    model: openai(MODEL),
    system: SYSTEM_PROMPT,
    messages: modelMessages(turn),
    stopWhen: stepCountIs(8),
    tools: {
      list_docs: tool({
        description: LIST_DOCS_DESCRIPTION,
        inputSchema: z.object({}),
        execute: async () => listDocs(),
      }),
      read_doc: tool({
        description: READ_DOC_DESCRIPTION,
        inputSchema: z.object({
          url: z.string(),
        }),
        execute: async ({ url }) => readDoc(url),
      }),
    },
    telemetry: {
      isEnabled: true,
      functionId: AGENT_NAME,
      integrations: [lemmaTelemetry as Telemetry],
    },
  });
  await lemmaTelemetry.flush();
  return result.text;
}

await runCli(runTurn);
