import { randomUUID } from "node:crypto";

import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";

import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
  type CompletedCodingAgentTurn,
  type OpenCodingAgentTurn,
} from "@uselemma/tracing";

import {
  LEMMA_PI_CREDENTIALS_HELP,
  readCredentialsSync,
  type LemmaPiCredentials,
} from "./credentials.js";
import { sanitizeValue } from "./sanitize.js";

type ExtensionDependencies = {
  now?: () => Date;
  createId?: () => string;
  readCredentials?: () => LemmaPiCredentials | null;
  sendTrace?: (
    turn: CompletedCodingAgentTurn,
    credentials: LemmaPiCredentials,
  ) => Promise<void>;
};

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    )
    .join("");
}

function assistantResponse(event: AgentEndEvent): string {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index] as { role?: unknown };
    if (message.role === "assistant") return messageText(message);
  }
  return "";
}

async function defaultSendTrace(
  turn: CompletedCodingAgentTurn,
  credentials: LemmaPiCredentials,
): Promise<void> {
  const trace = codingAgentTurnTrace(turn);
  await new Lemma({
    apiKey: credentials.accessToken,
    projectId: credentials.projectId,
    baseUrl: credentials.apiUrl,
  }).ingest(trace.context, {
    startedAt: new Date(trace.startedAt),
    endedAt: new Date(trace.endedAt),
  });
}

function warn(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "warning");
}

export function createLemmaPiExtension(
  dependencies: ExtensionDependencies = {},
): (pi: ExtensionAPI) => void {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;
  const readCredentials =
    dependencies.readCredentials ?? (() => readCredentialsSync());
  const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
  let activeTurn: OpenCodingAgentTurn | undefined;

  return (pi) => {
    pi.on(
      "before_agent_start",
      (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
        activeTurn = startCodingAgentTurn({
          harness: "pi",
          sessionId: ctx.sessionManager.getSessionId(),
          turnId: createId(),
          prompt: event.prompt,
          startedAt: now().toISOString(),
          model: ctx.model?.id,
          provider: ctx.model?.provider,
          metadata: {
            "lemma.harness.session_event_source": "native-lifecycle",
            "pi.compatibility_source": "extension-events",
          },
        });
      },
    );

    pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
      if (!activeTurn) return;
      activeTurn = recordCodingAgentToolStart(activeTurn, {
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        input: sanitizeValue(event.args),
        startedAt: now().toISOString(),
      });
    });

    pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
      if (!activeTurn) return;
      activeTurn = recordCodingAgentToolResult(activeTurn, {
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        output: event.isError ? undefined : sanitizeValue(event.result),
        error: event.isError ? "Pi tool execution failed" : undefined,
        endedAt: now().toISOString(),
      });
    });

    pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
      const open = activeTurn;
      activeTurn = undefined;
      if (!open) return;
      let credentials: LemmaPiCredentials | null;
      try {
        credentials = readCredentials();
      } catch {
        warn(ctx, LEMMA_PI_CREDENTIALS_HELP);
        return;
      }
      if (!credentials) {
        warn(ctx, LEMMA_PI_CREDENTIALS_HELP);
        return;
      }
      const completed = completeCodingAgentTurn(open, {
        response: assistantResponse(event),
        endedAt: now().toISOString(),
        model: ctx.model?.id,
        provider: ctx.model?.provider,
      });
      try {
        await sendTrace(completed, credentials);
      } catch {
        warn(
          ctx,
          "Lemma Pi trace delivery failed. Run `pnpm dlx @uselemma/pi setup` to reconnect or rotate the scoped credential.",
        );
      }
    });
  };
}
