import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
  type CodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";

import {
  codingAgentTurnRevision,
  listPendingTurns,
  queueCompletedTurn,
  readCredentials,
  readPendingTurn,
  readTurn,
  removeAbandonedTurns,
  removePending,
  removePendingTurn,
  removeTurn,
  resolveDataDir,
  withSessionLock,
  writeTurn,
} from "./storage.js";

type HookEventName = "UserPromptSubmit" | "PreToolUse" | "PostToolUse";
type TurnCompleteEventName = "AgentTurnComplete";
type CodexEventName = HookEventName | TurnCompleteEventName;

const OPEN_TURN_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const TRANSCRIPT_RECONCILIATION_ATTEMPTS = 3;
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "exec_command",
  "functions.exec_command",
  "shell",
  "unified_exec",
  "write_stdin",
]);
const ORCHESTRATOR_TOOL_NAMES = new Set(["exec", "functions.exec"]);

export type CodexHookInput = Record<string, unknown> & {
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
};

export type HookHandlerDependencies = {
  dataDir?: string;
  now?: () => Date;
  reconcileTranscript?: (
    turn: CodingAgentTurn,
    input: CodexHookInput,
    fallbackEndedAt: string,
  ) => Promise<CodingAgentTurn>;
  sendTrace?: (input: {
    apiUrl: string;
    projectId: string;
    accessToken: string;
    turn: Parameters<typeof codingAgentTurnTrace>[0];
  }) => Promise<void>;
  waitUntilReady?: boolean;
  warn?: (message: string) => void;
};

export type HookHandlerResult =
  | { status: "ignored" }
  | { status: "recorded"; event: CodexEventName }
  | { status: "queued"; traceId: string };

function stringField(input: CodexHookInput, name: string): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventName(input: CodexHookInput): CodexEventName | null {
  if (input.type === "agent-turn-complete") return "AgentTurnComplete";
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return input.hook_event_name;
    default:
      return null;
  }
}

function sessionId(input: CodexHookInput): string | undefined {
  return stringField(input, "session_id") ?? stringField(input, "thread-id");
}

function turnId(input: CodexHookInput): string | undefined {
  return stringField(input, "turn_id") ?? stringField(input, "turn-id");
}

function isMainAgent(input: CodexHookInput): boolean {
  return !(
    stringField(input, "agent_id") ||
    stringField(input, "subagent_id") ||
    stringField(input, "parent_session_id") ||
    input.agent_type === "subagent"
  );
}

function eventTimestamp(input: CodexHookInput, now: () => Date): string {
  const supplied = stringField(input, "timestamp");
  if (supplied && !Number.isNaN(Date.parse(supplied))) {
    return new Date(supplied).toISOString();
  }
  return now().toISOString();
}

function turnMetadata(input: CodexHookInput): Record<string, unknown> {
  return {
    ...(stringField(input, "cwd")
      ? { "lemma.harness.cwd": stringField(input, "cwd") }
      : {}),
    ...(stringField(input, "transcript_path")
      ? {
          "lemma.harness.transcript_path": stringField(
            input,
            "transcript_path",
          ),
        }
      : {}),
  };
}

function toolOutput(input: CodexHookInput): unknown {
  return input.tool_response ?? input.tool_output ?? input.response;
}

function isCommandTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    SHELL_TOOL_NAMES.has(normalized) || ORCHESTRATOR_TOOL_NAMES.has(normalized)
  );
}

function exitCode(value: unknown): number | undefined {
  if (typeof value === "string") {
    const match = value.match(
      /(?:process exited with code|exit code:)\s*(-?\d+)/i,
    );
    return match ? Number(match[1]) : undefined;
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = exitCode(nested);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = value.exit_code ?? value.exitCode;
  if (typeof direct === "number") return direct;
  for (const nested of Object.values(value)) {
    const found = exitCode(nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function explicitOutputError(output: unknown): unknown {
  if (!isRecord(output)) return undefined;
  if (output.error !== undefined) return output.error;
  if (output.isError === true) return output;
  return undefined;
}

function scriptFailed(output: unknown): boolean {
  if (typeof output === "string" && /^Script failed(?:\n|$)/.test(output)) {
    return true;
  }
  return (
    Array.isArray(output) &&
    output.some(
      (entry) =>
        isRecord(entry) &&
        typeof entry.text === "string" &&
        /^Script failed(?:\n|$)/.test(entry.text),
    )
  );
}

function commandFailure(output: unknown, toolName: string): unknown {
  if (scriptFailed(output)) return "Command failed";
  if (!SHELL_TOOL_NAMES.has(toolName.toLowerCase())) return undefined;
  const code = exitCode(output);
  if (code !== undefined && code !== 0) {
    return `Process exited with code ${code}`;
  }
  return undefined;
}

function toolError(input: CodexHookInput, toolName: string): unknown {
  if (input.error !== undefined) return input.error;
  const output = toolOutput(input);
  return (
    explicitOutputError(output) ??
    (isCommandTool(toolName) ? commandFailure(output, toolName) : undefined)
  );
}

function transcriptPath(
  input: CodexHookInput,
  turn: CodingAgentTurn,
): string | undefined {
  const current = stringField(input, "transcript_path");
  if (current) return current;
  const stored = turn.metadata?.["lemma.harness.transcript_path"];
  return typeof stored === "string" ? stored : undefined;
}

async function reconcileTranscriptToolResults(
  turn: CodingAgentTurn,
  input: CodexHookInput,
  fallbackEndedAt: string,
  warn?: (message: string) => void,
): Promise<CodingAgentTurn> {
  const path = transcriptPath(input, turn);
  if (!path) return turn;
  const toolsById = new Map(
    turn.tools.map((tool) => [tool.toolUseId, tool] as const),
  );
  const results = new Map<string, { output: unknown; error: unknown }>();
  try {
    const lines = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (!isRecord(entry) || entry.type !== "response_item") continue;
        const payload = entry.payload;
        if (
          !isRecord(payload) ||
          (payload.type !== "function_call_output" &&
            payload.type !== "custom_tool_call_output") ||
          typeof payload.call_id !== "string" ||
          !toolsById.has(payload.call_id)
        ) {
          continue;
        }
        const tool = toolsById.get(payload.call_id);
        if (!tool) continue;
        results.set(payload.call_id, {
          output: payload.output,
          error:
            explicitOutputError(payload.output) ??
            (isCommandTool(tool.toolName)
              ? commandFailure(payload.output, tool.toolName)
              : undefined),
        });
      } catch {
        // Ignore malformed or partially written JSONL records. The completion
        // notification itself is authoritative even when transcript repair is
        // unavailable.
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return turn;
    warn?.(
      `Lemma Codex could not inspect the transcript for tool results: ${error instanceof Error ? error.message : String(error)}`,
    );
    return turn;
  }

  return turn.tools.reduce((current, tool) => {
    const result = results.get(tool.toolUseId);
    if (!result) return current;
    return recordCodingAgentToolResult(current, {
      toolUseId: tool.toolUseId,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output ?? result.output,
      error: result.error ?? tool.error,
      endedAt: tool.endedAt ?? fallbackEndedAt,
    });
  }, turn);
}

async function defaultSendTrace(input: {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  turn: Parameters<typeof codingAgentTurnTrace>[0];
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const fetchWithTimeout: typeof fetch = async (request, init) =>
    fetch(request, { ...init, signal: controller.signal });
  const lemma = new Lemma({
    apiKey: input.accessToken,
    projectId: input.projectId,
    baseUrl: input.apiUrl,
    fetch: fetchWithTimeout,
  });
  const trace = codingAgentTurnTrace(input.turn);
  try {
    await lemma.ingest(trace.context, {
      startedAt: new Date(trace.startedAt),
      endedAt: new Date(trace.endedAt),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushPendingTurns(
  dependencies: HookHandlerDependencies = {},
): Promise<number> {
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  if (dependencies.waitUntilReady) {
    const pending = await listPendingTurns(dataDir);
    const delays = pending.map(({ readyAt }) =>
      readyAt ? Math.max(0, Date.parse(readyAt) - Date.now()) : 0,
    );
    const delay = delays.length > 0 ? Math.min(...delays) : 0;
    if (delay > 0) {
      await new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, delay),
      );
    }
  }
  return withSessionLock(dataDir, "lemma-codex-delivery", async () => {
    const credentials = await readCredentials(dataDir);
    if (!credentials) return 0;
    const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
    let sent = 0;
    for (const listed of await listPendingTurns(dataDir)) {
      let pending = await withSessionLock(
        dataDir,
        listed.turn.sessionId,
        async () => readPendingTurn(listed.path),
      );
      if (pending?.readyAt) {
        const delay = Date.parse(pending.readyAt) - Date.now();
        if (delay > 0) {
          pending = null;
        }
      }
      if (!pending) continue;
      const currentPendingPath = pending.path;
      const deliverable = await withSessionLock(
        dataDir,
        pending.turn.sessionId,
        async () => {
          const latest = await readPendingTurn(currentPendingPath);
          if (!latest) return null;
          if (latest.sourceRevision) {
            const open = await readTurn(
              dataDir,
              latest.turn.sessionId,
              latest.turn.turnId,
            );
            if (
              open &&
              codingAgentTurnRevision(open) !== latest.sourceRevision
            ) {
              await removePending(latest.path);
              return null;
            }
          }
          return latest;
        },
      );
      if (!deliverable) continue;
      pending = deliverable;
      if (
        pending.apiUrl !== credentials.apiUrl ||
        pending.projectId !== credentials.projectId
      ) {
        dependencies.warn?.(
          `Lemma Codex retained trace ${pending.turn.traceId}: it belongs to another configured project`,
        );
        continue;
      }
      try {
        await sendTrace({
          apiUrl: credentials.apiUrl,
          projectId: credentials.projectId,
          accessToken: credentials.accessToken,
          turn: pending.turn,
        });
        await withSessionLock(dataDir, pending.turn.sessionId, async () => {
          const latest = await readPendingTurn(pending.path);
          const sameDelivery = pending.deliveryId
            ? latest?.deliveryId === pending.deliveryId
            : latest?.turn.endedAt === pending.turn.endedAt;
          if (!sameDelivery) return;
          await removePending(pending.path);
          const open = await readTurn(
            dataDir,
            pending.turn.sessionId,
            pending.turn.turnId,
          );
          if (
            !pending.sourceRevision ||
            (open && codingAgentTurnRevision(open) === pending.sourceRevision)
          ) {
            await removeTurn(
              dataDir,
              pending.turn.sessionId,
              pending.turn.turnId,
            );
          }
        });
        sent += 1;
      } catch (error) {
        dependencies.warn?.(
          `Lemma Codex retained a trace for retry (${pending.turn.traceId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return sent;
  });
}

async function flushWithoutBlockingEvent(
  dependencies: HookHandlerDependencies,
): Promise<void> {
  if (!dependencies.sendTrace) return;
  try {
    await flushPendingTurns(dependencies);
  } catch (error) {
    dependencies.warn?.(
      `Lemma Codex retained a trace for retry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleCodexHook(
  input: CodexHookInput,
  dependencies: HookHandlerDependencies = {},
): Promise<HookHandlerResult> {
  const event = eventName(input);
  if (!event || !isMainAgent(input)) return { status: "ignored" };
  const currentSessionId = sessionId(input);
  const currentTurnId = turnId(input);
  if (!currentSessionId || !currentTurnId) return { status: "ignored" };

  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => new Date());

  if (event === "UserPromptSubmit") {
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    const startedAt = eventTimestamp(input, now);
    await withSessionLock(dataDir, currentSessionId, async () => {
      await removeAbandonedTurns(dataDir, {
        olderThan: new Date(
          new Date(startedAt).getTime() - OPEN_TURN_MAX_AGE_MS,
        ),
      });
      const existing = await readTurn(dataDir, currentSessionId, currentTurnId);
      if (existing?.status === "open") {
        await removePendingTurn(dataDir, existing.traceId);
        await writeTurn(dataDir, {
          ...existing,
          prompt:
            existing.prompt === prompt
              ? existing.prompt
              : `${existing.prompt}\n\n${prompt}`,
          model: stringField(input, "model") ?? existing.model,
          metadata: { ...(existing.metadata ?? {}), ...turnMetadata(input) },
        });
        return;
      }
      await writeTurn(
        dataDir,
        startCodingAgentTurn({
          harness: "codex",
          sessionId: currentSessionId,
          turnId: currentTurnId,
          prompt,
          startedAt,
          model: stringField(input, "model"),
          provider: "openai",
          metadata: turnMetadata(input),
        }),
      );
    });
    await flushWithoutBlockingEvent(dependencies);
    return { status: "recorded", event };
  }

  if (event === "PreToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, currentSessionId, async () => {
      const turn = await readTurn(dataDir, currentSessionId, currentTurnId);
      if (!turn || turn.status !== "open") return;
      await removePendingTurn(dataDir, turn.traceId);
      await writeTurn(
        dataDir,
        recordCodingAgentToolStart(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          startedAt: eventTimestamp(input, now),
        }),
      );
    });
    return { status: "recorded", event };
  }

  if (event === "PostToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, currentSessionId, async () => {
      const turn = await readTurn(dataDir, currentSessionId, currentTurnId);
      if (!turn || turn.status !== "open") return;
      await removePendingTurn(dataDir, turn.traceId);
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          output: toolOutput(input),
          error: toolError(input, toolName),
          endedAt: eventTimestamp(input, now),
        }),
      );
    });
    return { status: "recorded", event };
  }

  const response =
    stringField(input, "last_assistant_message") ??
    stringField(input, "last-assistant-message") ??
    "";
  const endedAt = eventTimestamp(input, now);
  const credentials = await readCredentials(dataDir);
  let traceId: string | null = null;
  let snapshot = await withSessionLock(dataDir, currentSessionId, async () =>
    readTurn(dataDir, currentSessionId, currentTurnId),
  );
  for (
    let attempt = 0;
    snapshot && attempt < TRANSCRIPT_RECONCILIATION_ATTEMPTS;
    attempt += 1
  ) {
    const sourceRevision = codingAgentTurnRevision(snapshot);
    const reconciledTurn = dependencies.reconcileTranscript
      ? await dependencies.reconcileTranscript(snapshot, input, endedAt)
      : await reconcileTranscriptToolResults(
          snapshot,
          input,
          endedAt,
          dependencies.warn,
        );
    const result = await withSessionLock(
      dataDir,
      currentSessionId,
      async (): Promise<{
        traceId: string | null;
        retry: CodingAgentTurn | null;
      }> => {
        const latest = await readTurn(dataDir, currentSessionId, currentTurnId);
        if (!latest) return { traceId: null, retry: null };
        if (codingAgentTurnRevision(latest) !== sourceRevision) {
          return { traceId: null, retry: latest };
        }
        const completed = completeCodingAgentTurn(reconciledTurn, {
          response,
          endedAt,
          model: stringField(input, "model"),
          provider: "openai",
        });
        if (credentials) {
          await writeTurn(dataDir, reconciledTurn);
          await queueCompletedTurn(dataDir, completed, credentials, {
            sourceRevision: codingAgentTurnRevision(reconciledTurn),
          });
        }
        return {
          traceId: credentials ? completed.traceId : null,
          retry: null,
        };
      },
    );
    traceId = result.traceId;
    snapshot = result.retry;
  }
  if (snapshot) {
    dependencies.warn?.(
      "Lemma Codex retained an open turn because tool state kept changing during completion",
    );
  }
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Codex did not queue the completed turn because setup is incomplete",
    );
    return { status: "ignored" };
  }
  await flushWithoutBlockingEvent(dependencies);
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}
