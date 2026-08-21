import type { PluginInput } from "@opencode-ai/plugin";
import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk";
import {
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
  type OpenCodingAgentTurn,
} from "@uselemma/tracing";

import { writePendingTurn } from "./pending.js";
import { sanitizeText, sanitizeValue } from "./sanitize.js";
import {
  readCredentials,
  type LemmaOpenCodeCredentialScope,
  type StorageOptions,
} from "./storage.js";

type SessionMessage = { info: Message; parts: Part[] };
type OpenCodeClient = Pick<PluginInput["client"], "session">;

type ActiveTurn = {
  turn: OpenCodingAgentTurn;
  credentialScope: LemmaOpenCodeCredentialScope;
  assistant?: AssistantMessage;
  assistantText: Map<string, string>;
  userText: Map<string, string>;
};

type AdapterDependencies = StorageOptions & {
  client: OpenCodeClient;
  directory: string;
  now?: () => string;
  scheduleFlush?: () => void;
  writePending?: typeof writePendingTurn;
  warn?: (message: string) => void;
};

function isoTime(
  milliseconds: number | undefined,
  fallback: () => string,
): string {
  return milliseconds === undefined
    ? fallback()
    : new Date(milliseconds).toISOString();
}

function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text";
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === "tool";
}

function textFromParts(parts: Part[]): string {
  return sanitizeText(
    parts
      .filter(isTextPart)
      .filter((part) => !part.synthetic && !part.ignored)
      .map((part) => part.text)
      .join("\n")
      .trim(),
  );
}

function userMetadata(message: UserMessage): Record<string, unknown> {
  return {
    "opencode.agent": message.agent,
    ...(message.system ? { "opencode.system_prompt_present": true } : {}),
  };
}

function startTurn(
  message: UserMessage,
  parts: Part[],
  credentialScope: LemmaOpenCodeCredentialScope,
  now: () => string,
): ActiveTurn {
  const userText = new Map(
    parts
      .filter(isTextPart)
      .filter((part) => !part.synthetic && !part.ignored)
      .map((part) => [part.id, sanitizeText(part.text)]),
  );
  return {
    turn: startCodingAgentTurn({
      harness: "opencode",
      sessionId: message.sessionID,
      turnId: message.id,
      prompt: textFromParts(parts),
      startedAt: isoTime(message.time.created, now),
      model: message.model.modelID,
      provider: message.model.providerID,
      metadata: userMetadata(message),
    }),
    credentialScope,
    assistantText: new Map(),
    userText,
  };
}

function promptFromUserText(active: ActiveTurn): string {
  return [...active.userText.values()].join("\n").trim();
}

function latestSessionPair(
  messages: SessionMessage[],
  turnId: string,
): { user?: SessionMessage; assistant?: SessionMessage } {
  const user = messages.find(
    (message) => message.info.role === "user" && message.info.id === turnId,
  );
  const assistants = messages.filter(
    (message) =>
      message.info.role === "assistant" && message.info.parentID === turnId,
  );
  return { user, assistant: assistants.at(-1) };
}

function toolOutput(part: ToolPart): {
  output?: unknown;
  error?: unknown;
  endedAt?: string;
} {
  if (part.state.status === "completed") {
    return {
      output: sanitizeValue({
        title: part.state.title,
        output: part.state.output,
        metadata: part.state.metadata,
      }),
      endedAt: new Date(part.state.time.end).toISOString(),
    };
  }
  if (part.state.status === "error") {
    return {
      error: sanitizeValue(part.state.error),
      endedAt: new Date(part.state.time.end).toISOString(),
    };
  }
  return {};
}

function updateFromToolPart(active: ActiveTurn, part: ToolPart): void {
  if (part.state.status === "pending") return;
  active.turn = recordCodingAgentToolStart(active.turn, {
    toolUseId: part.callID,
    toolName: part.tool,
    input: sanitizeValue(part.state.input),
    startedAt: new Date(part.state.time.start).toISOString(),
  });
  const result = toolOutput(part);
  if (!result.endedAt) return;
  active.turn = recordCodingAgentToolResult(active.turn, {
    toolUseId: part.callID,
    toolName: part.tool,
    input: sanitizeValue(part.state.input),
    output: result.output,
    error: result.error,
    endedAt: result.endedAt,
  });
}

function eventSessionId(event: Event): string | undefined {
  if (!("sessionID" in event.properties)) return undefined;
  return typeof event.properties.sessionID === "string"
    ? event.properties.sessionID
    : undefined;
}

export function createOpenCodeAdapter(dependencies: AdapterDependencies) {
  const activeBySession = new Map<string, ActiveTurn>();
  const retryBacklog = new Set<ActiveTurn>();
  const finalizingTurns = new Map<ActiveTurn, Promise<void>>();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const scheduleFlush = dependencies.scheduleFlush ?? (() => undefined);
  const writePending = dependencies.writePending ?? writePendingTurn;
  const warn =
    dependencies.warn ?? ((message: string) => console.warn(message));

  async function sessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const result = await dependencies.client.session.messages({
      path: { id: sessionId },
      query: { directory: dependencies.directory },
    });
    return result.data ?? [];
  }

  function finishActive(
    sessionId: string,
    active: ActiveTurn,
    options: { startFlush: boolean } = { startFlush: true },
  ): Promise<void> {
    const existing = finalizingTurns.get(active);
    if (existing) return existing;
    const finalization = (async () => {
      try {
        const messages = await sessionMessages(sessionId);
        const pair = latestSessionPair(messages, active.turn.turnId);
        if (pair.user) {
          active.turn = {
            ...active.turn,
            prompt: textFromParts(pair.user.parts),
          };
        }
        if (pair.assistant?.info.role === "assistant") {
          active.assistant = pair.assistant.info;
          for (const part of pair.assistant.parts) {
            if (isTextPart(part) && !part.synthetic && !part.ignored) {
              active.assistantText.set(part.id, sanitizeText(part.text));
            }
            if (isToolPart(part)) updateFromToolPart(active, part);
          }
        }
        const response =
          [...active.assistantText.values()].join("\n").trim() ||
          (active.assistant?.error
            ? `OpenCode turn failed: ${JSON.stringify(sanitizeValue(active.assistant.error))}`
            : "OpenCode turn completed without a text response");
        const completedAt = active.assistant?.time.completed;
        const createdAt = active.assistant?.time.created;
        const completed = completeCodingAgentTurn(active.turn, {
          response,
          endedAt: isoTime(completedAt, now),
          model: active.assistant?.modelID,
          provider: active.assistant?.providerID,
          ...(createdAt !== undefined && completedAt !== undefined
            ? {
                generationStartedAt: new Date(createdAt).toISOString(),
                generationEndedAt: new Date(completedAt).toISOString(),
              }
            : {}),
        });
        await writePending(completed, active.credentialScope, dependencies);
        retryBacklog.delete(active);
        if (activeBySession.get(sessionId) === active) {
          activeBySession.delete(sessionId);
        }
        if (options.startFlush) {
          try {
            scheduleFlush();
          } catch (error) {
            warn(
              `Lemma OpenCode queued the completed turn but could not start delivery: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error) {
        retryBacklog.add(active);
        if (activeBySession.get(sessionId) === active) {
          activeBySession.delete(sessionId);
        }
        warn(
          `Lemma OpenCode could not queue the completed turn: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        finalizingTurns.delete(active);
      }
    })();
    finalizingTurns.set(active, finalization);
    return finalization;
  }

  function finish(
    sessionId: string,
    options: { startFlush: boolean } = { startFlush: true },
  ): Promise<void> {
    const active = activeBySession.get(sessionId);
    return active
      ? finishActive(sessionId, active, options)
      : Promise.resolve();
  }

  async function retryFailedTurns(
    options: { startFlush: boolean } = { startFlush: true },
  ): Promise<void> {
    await Promise.all(
      [...retryBacklog].map((active) =>
        finishActive(active.turn.sessionId, active, options),
      ),
    );
  }

  async function beginTurn(message: UserMessage, parts: Part[]): Promise<void> {
    await retryFailedTurns();
    const existing = activeBySession.get(message.sessionID);
    if (existing && existing.turn.turnId !== message.id) {
      await finishActive(message.sessionID, existing);
    }
    const credentials = await readCredentials(dependencies);
    if (!credentials) {
      warn(
        "Lemma OpenCode skipped tracing because no scoped credential is configured.",
      );
      return;
    }
    activeBySession.set(
      message.sessionID,
      startTurn(
        message,
        parts,
        {
          apiUrl: credentials.apiUrl,
          projectId: credentials.projectId,
          credentialId: credentials.credentialId,
        },
        now,
      ),
    );
  }

  return {
    async chatMessage(message: UserMessage, parts: Part[]): Promise<void> {
      await beginTurn(message, parts);
    },

    beforeTool(
      input: { tool: string; sessionID: string; callID: string },
      args: unknown,
    ): void {
      const active = activeBySession.get(input.sessionID);
      if (!active) return;
      active.turn = recordCodingAgentToolStart(active.turn, {
        toolUseId: input.callID,
        toolName: input.tool,
        input: sanitizeValue(args),
        startedAt: now(),
      });
    },

    afterTool(
      input: {
        tool: string;
        sessionID: string;
        callID: string;
        args: unknown;
      },
      output: { title: string; output: string; metadata: unknown },
    ): void {
      const active = activeBySession.get(input.sessionID);
      if (!active) return;
      active.turn = recordCodingAgentToolResult(active.turn, {
        toolUseId: input.callID,
        toolName: input.tool,
        input: sanitizeValue(input.args),
        output: sanitizeValue(output),
        endedAt: now(),
      });
    },

    async event(event: Event): Promise<void> {
      const sessionId = eventSessionId(event);
      if (event.type === "message.updated") {
        const message = event.properties.info;
        if (message.role === "user") {
          const existing = activeBySession.get(message.sessionID);
          if (!existing || existing.turn.turnId !== message.id) {
            await beginTurn(message, []);
          }
          return;
        }
        const active = activeBySession.get(message.sessionID);
        if (active && message.parentID === active.turn.turnId) {
          active.assistant = message;
        }
        return;
      }
      if (event.type === "message.part.updated") {
        const part = event.properties.part;
        const active = activeBySession.get(part.sessionID);
        if (!active) return;
        if (part.messageID === active.turn.turnId && isTextPart(part)) {
          if (!part.synthetic && !part.ignored) {
            active.userText.set(part.id, sanitizeText(part.text));
            active.turn = {
              ...active.turn,
              prompt: promptFromUserText(active),
            };
          }
          return;
        }
        if (active.assistant && part.messageID !== active.assistant.id) return;
        if (isTextPart(part) && !part.synthetic && !part.ignored) {
          active.assistantText.set(part.id, sanitizeText(part.text));
        } else if (isToolPart(part)) {
          updateFromToolPart(active, part);
        }
        return;
      }
      if (event.type === "session.idle" && sessionId) {
        await finish(sessionId);
      }
    },

    async dispose(): Promise<void> {
      await Promise.all(
        [...activeBySession.keys()].map((sessionId) =>
          finish(sessionId, { startFlush: false }),
        ),
      );
      await retryFailedTurns({ startFlush: false });
      if (retryBacklog.size > 0) {
        throw new Error(
          `Lemma OpenCode could not persist ${retryBacklog.size} completed turn${retryBacklog.size === 1 ? "" : "s"} during shutdown`,
        );
      }
    },

    pendingTurnCount(): number {
      return activeBySession.size + retryBacklog.size;
    },
  };
}
