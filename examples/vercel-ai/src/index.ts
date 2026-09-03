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
  // Create one vercelAI() integration per AI SDK call. Do not wrap this in lemma.trace().
  // AI SDK v7 telemetry options no longer take `metadata`; pass thread/user on the integration.
  const lemmaTelemetry = vercelAI({
    metadata: {
      threadId: turn.identity.threadId,
      ...(turn.identity.userId ? { userId: turn.identity.userId } : {}),
    },
  });

  try {
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
  } catch (error) {
    await lemmaTelemetry.fail(error);
    throw error;
  }
}

await runCli(runTurn);
