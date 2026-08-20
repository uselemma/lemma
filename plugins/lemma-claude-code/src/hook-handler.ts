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
  listPendingTurns,
  queueCompletedTurn,
  readCredentials,
  readPendingTurn,
  readStagedPrompt,
  readTurn,
  removePending,
  removeStagedPrompt,
  removeTurn,
  resolveDataDir,
  withSessionLock,
  writeStagedPrompt,
  writeTurn,
  type StagedClaudePrompt,
} from "./storage.js";

type ClaudeEventName =
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Stop";

export type ClaudeHookInput = Record<string, unknown> & {
  hook_event_name?: unknown;
  session_id?: unknown;
  prompt_id?: unknown;
};

export type HookHandlerDependencies = {
  dataDir?: string;
  now?: () => Date;
  sendTrace?: (input: {
    apiUrl: string;
    projectId: string;
    accessToken: string;
    turn: Parameters<typeof codingAgentTurnTrace>[0];
  }) => Promise<void>;
  warn?: (message: string) => void;
};

export type HookHandlerResult =
  | { status: "ignored" }
  | { status: "recorded"; event: ClaudeEventName }
  | { status: "queued"; traceId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(input: ClaudeHookInput, name: string): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventName(input: ClaudeHookInput): ClaudeEventName | null {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "Stop":
      return input.hook_event_name;
    default:
      return null;
  }
}

function eventTimestamp(input: ClaudeHookInput, now: () => Date): string {
  const supplied = stringField(input, "timestamp");
  if (supplied && !Number.isNaN(Date.parse(supplied))) {
    return new Date(supplied).toISOString();
  }
  return now().toISOString();
}

function turnMetadata(input: ClaudeHookInput): Record<string, unknown> {
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

function toolError(input: ClaudeHookInput): unknown {
  if (input.error !== undefined) return input.error;
  if (input.is_error === true) return input.tool_response ?? "Tool failed";
  if (!isRecord(input.tool_response)) return undefined;
  if (input.tool_response.error !== undefined) return input.tool_response.error;
  const exitCode = input.tool_response.exit_code;
  return typeof exitCode === "number" && exitCode !== 0
    ? `Process exited with code ${exitCode}`
    : undefined;
}

function mergeMetadata(
  first?: Record<string, unknown>,
  second?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...(first ?? {}), ...(second ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function materializeTurn(
  dataDir: string,
  sessionId: string,
  promptId: string,
  input: ClaudeHookInput,
  now: () => Date,
): Promise<CodingAgentTurn | null> {
  const existing = await readTurn(dataDir, sessionId, promptId);
  if (existing) return existing;
  const staged = await readStagedPrompt(dataDir, sessionId);
  const directPrompt = stringField(input, "prompt");
  if (!staged && !directPrompt) return null;
  const source: StagedClaudePrompt = staged ?? {
    version: 1,
    sessionId,
    prompt: directPrompt ?? "",
    startedAt: eventTimestamp(input, now),
    model: stringField(input, "model"),
    metadata: turnMetadata(input),
  };
  const turn = startCodingAgentTurn({
    harness: "claude-code",
    sessionId,
    turnId: promptId,
    prompt: source.prompt,
    startedAt: source.startedAt,
    model: source.model ?? stringField(input, "model"),
    provider: "anthropic",
    metadata: mergeMetadata(source.metadata, turnMetadata(input)),
  });
  await writeTurn(dataDir, turn);
  if (staged) await removeStagedPrompt(dataDir, sessionId);
  return turn;
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
  return withSessionLock(dataDir, "lemma-claude-code-delivery", async () => {
    const credentials = await readCredentials(dataDir);
    if (!credentials) return 0;
    const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
    let sent = 0;
    for (const listed of await listPendingTurns(dataDir)) {
      const pending = await readPendingTurn(listed.path);
      if (!pending) continue;
      if (
        pending.apiUrl !== credentials.apiUrl ||
        pending.projectId !== credentials.projectId
      ) {
        dependencies.warn?.(
          `Lemma Claude Code retained trace ${pending.turn.traceId}: it belongs to another configured project`,
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
          if (latest?.deliveryId !== pending.deliveryId) return;
          await removePending(pending.path);
          await removeTurn(
            dataDir,
            pending.turn.sessionId,
            pending.turn.turnId,
          );
        });
        sent += 1;
      } catch (error) {
        dependencies.warn?.(
          `Lemma Claude Code retained a trace for retry (${pending.turn.traceId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return sent;
  });
}

export async function handleClaudeHook(
  input: ClaudeHookInput,
  dependencies: HookHandlerDependencies = {},
): Promise<HookHandlerResult> {
  const event = eventName(input);
  const sessionId = stringField(input, "session_id");
  if (!event || !sessionId) return { status: "ignored" };
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => new Date());

  if (event === "UserPromptSubmit") {
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    const promptId = stringField(input, "prompt_id");
    await withSessionLock(dataDir, sessionId, async () => {
      if (promptId) {
        await writeTurn(
          dataDir,
          startCodingAgentTurn({
            harness: "claude-code",
            sessionId,
            turnId: promptId,
            prompt,
            startedAt: eventTimestamp(input, now),
            model: stringField(input, "model"),
            provider: "anthropic",
            metadata: turnMetadata(input),
          }),
        );
        return;
      }
      await writeStagedPrompt(dataDir, {
        version: 1,
        sessionId,
        prompt,
        startedAt: eventTimestamp(input, now),
        model: stringField(input, "model"),
        metadata: turnMetadata(input),
      });
    });
    return { status: "recorded", event };
  }

  const promptId = stringField(input, "prompt_id");
  if (!promptId) return { status: "ignored" };

  if (event === "PreToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await materializeTurn(
        dataDir,
        sessionId,
        promptId,
        input,
        now,
      );
      if (!turn || turn.status !== "open") return;
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

  if (event === "PostToolUse" || event === "PostToolUseFailure") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await materializeTurn(
        dataDir,
        sessionId,
        promptId,
        input,
        now,
      );
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          output: input.tool_response,
          error: toolError(input),
          endedAt: eventTimestamp(input, now),
        }),
      );
    });
    return { status: "recorded", event };
  }

  const credentials = await readCredentials(dataDir);
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Claude Code did not queue the completed prompt because setup is incomplete",
    );
    return { status: "ignored" };
  }
  const traceId = await withSessionLock(dataDir, sessionId, async () => {
    const turn = await materializeTurn(
      dataDir,
      sessionId,
      promptId,
      input,
      now,
    );
    if (!turn) return null;
    const completed =
      turn.status === "completed"
        ? turn
        : completeCodingAgentTurn(turn, {
            response: stringField(input, "last_assistant_message") ?? "",
            endedAt: eventTimestamp(input, now),
            model: stringField(input, "model"),
            provider: "anthropic",
          });
    if (turn.status === "open") await writeTurn(dataDir, completed);
    await queueCompletedTurn(dataDir, completed, credentials);
    return completed.traceId;
  });
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}
