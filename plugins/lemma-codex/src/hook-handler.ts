import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";

import {
  listPendingTurns,
  queueCompletedTurn,
  readCredentials,
  readTurn,
  removeAbandonedTurns,
  removePending,
  removeTurn,
  resolveDataDir,
  withSessionLock,
  writeTurn,
} from "./storage.js";

type HookEventName = "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";

const OPEN_TURN_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type CodexHookInput = Record<string, unknown> & {
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
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
  | { status: "recorded"; event: HookEventName }
  | { status: "queued"; traceId: string };

function stringField(input: CodexHookInput, name: string): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventName(input: CodexHookInput): HookEventName | null {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "Stop":
      return input.hook_event_name;
    default:
      return null;
  }
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

function toolError(input: CodexHookInput): unknown {
  if (input.error !== undefined) return input.error;
  const output = toolOutput(input);
  if (typeof output === "object" && output !== null) {
    if ("error" in output) return (output as { error?: unknown }).error;
    if (
      "isError" in output &&
      (output as { isError?: unknown }).isError === true
    ) {
      return output;
    }
  }
  return undefined;
}

async function defaultSendTrace(input: {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  turn: Parameters<typeof codingAgentTurnTrace>[0];
}): Promise<void> {
  const lemma = new Lemma({
    apiKey: input.accessToken,
    projectId: input.projectId,
    baseUrl: input.apiUrl,
  });
  const trace = codingAgentTurnTrace(input.turn);
  await lemma.ingest(trace.context, {
    startedAt: new Date(trace.startedAt),
    endedAt: new Date(trace.endedAt),
  });
}

export async function flushPendingTurns(
  dependencies: HookHandlerDependencies = {},
): Promise<number> {
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const credentials = await readCredentials(dataDir);
  if (!credentials) return 0;
  const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
  let sent = 0;
  for (const pending of await listPendingTurns(dataDir)) {
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
      await removePending(pending.path);
      sent += 1;
    } catch (error) {
      dependencies.warn?.(
        `Lemma Codex retained a trace for retry (${pending.turn.traceId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return sent;
}

async function flushWithoutBlockingEvent(
  dependencies: HookHandlerDependencies,
): Promise<void> {
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
  const sessionId = stringField(input, "session_id");
  const turnId = stringField(input, "turn_id");
  if (!sessionId || !turnId) return { status: "ignored" };

  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => new Date());

  if (event === "UserPromptSubmit") {
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    const startedAt = eventTimestamp(input, now);
    await withSessionLock(dataDir, sessionId, async () => {
      await removeAbandonedTurns(dataDir, {
        sessionId,
        currentTurnId: turnId,
        olderThan: new Date(
          new Date(startedAt).getTime() - OPEN_TURN_MAX_AGE_MS,
        ),
      });
      if (await readTurn(dataDir, sessionId, turnId)) return;
      await writeTurn(
        dataDir,
        startCodingAgentTurn({
          harness: "codex",
          sessionId,
          turnId,
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
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await readTurn(dataDir, sessionId, turnId);
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

  if (event === "PostToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await readTurn(dataDir, sessionId, turnId);
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          output: toolOutput(input),
          error: toolError(input),
          endedAt: eventTimestamp(input, now),
        }),
      );
    });
    return { status: "recorded", event };
  }

  const response = stringField(input, "last_assistant_message") ?? "";
  const endedAt = eventTimestamp(input, now);
  const credentials = await readCredentials(dataDir);
  let traceId: string | null = null;
  await withSessionLock(dataDir, sessionId, async () => {
    const turn = await readTurn(dataDir, sessionId, turnId);
    if (!turn) return;
    const closedTurn = turn.tools
      .filter((tool) => !tool.endedAt)
      .reduce(
        (current, tool) =>
          recordCodingAgentToolResult(current, {
            toolUseId: tool.toolUseId,
            toolName: tool.toolName,
            input: tool.input,
            error: "Codex ended the turn without a PostToolUse result",
            endedAt,
          }),
        turn,
      );
    const completed = completeCodingAgentTurn(closedTurn, {
      response,
      endedAt,
      model: stringField(input, "model"),
      provider: "openai",
    });
    if (credentials) {
      await queueCompletedTurn(dataDir, completed, credentials);
    }
    await removeTurn(dataDir, sessionId, turnId);
    traceId = credentials ? completed.traceId : null;
  });
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Codex did not queue the completed turn because setup is incomplete",
    );
    return { status: "ignored" };
  }
  await flushWithoutBlockingEvent(dependencies);
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}
