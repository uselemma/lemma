import OpenAI from "openai";
import { Lemma } from "@uselemma/tracing";
import {
  AGENT_NAME,
  LIST_DOCS_DESCRIPTION,
  MODEL,
  READ_DOC_DESCRIPTION,
  SYSTEM_PROMPT,
  executeDocsTool,
  loadExampleEnv,
  modelMessages,
  requireOpenAIKey,
  runCli,
  type ChatTurn,
} from "@lemma/examples-shared";

loadExampleEnv();

const lemma = new Lemma();
const openai = new OpenAI({ apiKey: requireOpenAIKey() });

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_docs",
      description: LIST_DOCS_DESCRIPTION,
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_doc",
      description: READ_DOC_DESCRIPTION,
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
];

async function runTurn(turn: ChatTurn): Promise<string> {
  // One user turn = one Lemma root. Do not wrap framework adapters this way.
  return lemma.trace(
    {
      name: AGENT_NAME,
      input: turn.message,
      threadId: turn.identity.threadId,
      userId: turn.identity.userId,
    },
    async (trace) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...modelMessages(turn),
      ];

      for (let step = 0; step < 8; step++) {
        const prompt = [...messages];
        const started = Date.now();
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: prompt,
          tools,
        });
        const choice = completion.choices[0]?.message;
        if (!choice) {
          throw new Error("OpenAI returned no message");
        }

        trace.recordGeneration({
          name: "answer",
          model: MODEL,
          input: prompt,
          output: choice.content ?? choice.tool_calls,
          durationMs: Date.now() - started,
          llmInputMessages: prompt,
          llmInvocationParameters: { model: MODEL },
          usage: completion.usage
            ? {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
              }
            : undefined,
        });

        messages.push(choice);

        if (!choice.tool_calls?.length) {
          return choice.content ?? "";
        }

        for (const call of choice.tool_calls) {
          if (call.type !== "function") continue;
          const args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
          const toolStarted = Date.now();
          try {
            const output = await executeDocsTool(call.function.name, args);
            trace.recordTool({
              name: call.function.name,
              input: args,
              output,
              durationMs: Date.now() - toolStarted,
              toolParameters:
                call.function.name === "read_doc" ? { url: "string" } : {},
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: output,
            });
          } catch (error) {
            trace.recordTool({
              name: call.function.name,
              input: args,
              error,
              durationMs: Date.now() - toolStarted,
            });
            throw error;
          }
        }
      }

      return "Stopped after the tool-call limit.";
    },
  );
}

await runCli(runTurn);
