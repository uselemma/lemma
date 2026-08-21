import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentRunEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/plugin-entry";

import { writePendingTurn } from "./pending.js";
import { lastAssistantText, sanitizeText, sanitizeValue } from "./sanitize.js";
import type { StorageOptions } from "./storage.js";
import type { OpenClawTurn } from "./types.js";

type OpenTurn = Omit<OpenClawTurn, "endedAt">;

type AdapterDependencies = StorageOptions & {
  now?: () => string;
  spawnFlush?: () => void;
};

function runtimePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../runtime/flush.mjs");
}

export function spawnDetachedFlush(): void {
  const child = spawn(process.execPath, [runtimePath()], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function correlationKey(
  eventRunId: string | undefined,
  context: PluginHookAgentContext | PluginHookToolContext,
): string {
  return eventRunId ?? context.runId ?? context.sessionId ?? context.sessionKey ?? "";
}

function fallbackSessionId(context: PluginHookAgentContext): string {
  return context.sessionId ?? context.sessionKey ?? context.runId ?? randomUUID();
}

function metadata(context: PluginHookAgentContext): Record<string, unknown> {
  return {
    ...(context.agentId ? { "openclaw.agent_id": context.agentId } : {}),
    ...(context.trigger ? { "openclaw.trigger": context.trigger } : {}),
    ...(context.channel ? { "openclaw.channel": context.channel } : {}),
  };
}

export function createOpenClawAdapter(dependencies: AdapterDependencies = {}) {
  const turns = new Map<string, OpenTurn>();
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startFlush = dependencies.spawnFlush ?? spawnDetachedFlush;

  return {
    beforeAgentRun(
      event: PluginHookBeforeAgentRunEvent,
      context: PluginHookAgentContext,
    ): void {
      const key = correlationKey(context.runId, context) || randomUUID();
      turns.set(key, {
        version: 1,
        sessionId: fallbackSessionId(context),
        turnId: context.runId ?? key,
        prompt: sanitizeText(event.prompt),
        response: "",
        startedAt: now(),
        model: context.modelId,
        provider: context.modelProviderId,
        metadata: metadata(context),
        tools: [],
      });
    },

    beforeToolCall(
      event: PluginHookBeforeToolCallEvent,
      context: PluginHookToolContext,
    ): void {
      const turn = turns.get(correlationKey(event.runId, context));
      if (!turn) return;
      turn.tools.push({
        toolUseId: event.toolCallId ?? `${event.toolName}:${turn.tools.length}`,
        toolName: event.toolName,
        input: sanitizeValue(event.params),
        startedAt: now(),
      });
    },

    afterToolCall(
      event: PluginHookAfterToolCallEvent,
      context: PluginHookToolContext,
    ): void {
      const turn = turns.get(correlationKey(event.runId, context));
      if (!turn) return;
      const identifier = event.toolCallId ?? "";
      let tool = [...turn.tools]
        .reverse()
        .find(
          (item) =>
            (identifier && item.toolUseId === identifier) ||
            (!identifier && item.toolName === event.toolName),
        );
      if (!tool) {
        tool = {
          toolUseId: identifier || `${event.toolName}:${turn.tools.length}`,
          toolName: event.toolName,
          input: sanitizeValue(event.params),
        };
        turn.tools.push(tool);
      }
      tool.endedAt = now();
      if (event.error) tool.error = sanitizeValue(event.error);
      else tool.output = sanitizeValue(event.result);
    },

    async agentEnd(
      event: PluginHookAgentEndEvent,
      context: PluginHookAgentContext,
    ): Promise<void> {
      const key = correlationKey(event.runId, context);
      const turn = turns.get(key);
      if (!turn) return;
      turns.delete(key);
      const response = sanitizeText(
        lastAssistantText(event.messages) ||
          (event.success ? "OpenClaw turn completed" : "OpenClaw turn failed"),
      );
      const completed: OpenClawTurn = {
        ...turn,
        response,
        endedAt: now(),
        metadata: {
          ...(turn.metadata ?? {}),
          "openclaw.success": event.success,
        },
      };
      if (await writePendingTurn(completed, dependencies)) startFlush();
    },

    pendingTurnCount(): number {
      return turns.size;
    },
  };
}
