import { TraceContext } from "./client";
import { failureMessage } from "./error-message";

export type CodingAgentHarnessId =
  | "claude-code"
  | "cursor"
  | "codex"
  | "pi"
  | "hermes"
  | "openclaw";

export type CodingAgentToolCall = {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  startedAt?: string;
  endedAt?: string;
  startTimeMissing?: boolean;
  resultMissing?: boolean;
};

const MISSING_TOOL_RESULT_ERROR =
  "Coding agent turn completed without a tool result";

type CodingAgentTurnBase = {
  version: 1;
  harness: CodingAgentHarnessId;
  sessionId: string;
  turnId: string;
  traceId: string;
  generationId: string;
  prompt: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  tools: CodingAgentToolCall[];
};

export type OpenCodingAgentTurn = CodingAgentTurnBase & {
  status: "open";
};

export type CompletedCodingAgentTurn = CodingAgentTurnBase & {
  status: "completed";
  response: string;
  endedAt: string;
};

export type CodingAgentTurn = OpenCodingAgentTurn | CompletedCodingAgentTurn;

export type StartCodingAgentTurnOptions = {
  harness: CodingAgentHarnessId;
  sessionId: string;
  turnId: string;
  prompt: string;
  startedAt: string;
  traceId?: string;
  generationId?: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
};

export type CodingAgentToolStart = {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  startedAt: string;
};

export type CodingAgentToolResult = {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  endedAt: string;
};

export type CompleteCodingAgentTurnOptions = {
  response: string;
  endedAt: string;
  model?: string;
  provider?: string;
};

export type CodingAgentTurnTrace = {
  context: TraceContext;
  startedAt: string;
  endedAt: string;
};

function requireOpen(turn: CodingAgentTurn): OpenCodingAgentTurn {
  if (turn.status === "completed") {
    throw new Error(
      `Coding agent turn ${turn.sessionId}/${turn.turnId} already completed`,
    );
  }
  return turn;
}

function harnessAttributes(turn: CodingAgentTurn): Record<string, unknown> {
  return {
    "lemma.harness.id": turn.harness,
    "lemma.harness.session_id": turn.sessionId,
    "lemma.harness.turn_id": turn.turnId,
    "lemma.sdk.integration": "coding-agent",
  };
}

export function startCodingAgentTurn(
  options: StartCodingAgentTurnOptions,
): OpenCodingAgentTurn {
  return {
    version: 1,
    status: "open",
    harness: options.harness,
    sessionId: options.sessionId,
    turnId: options.turnId,
    traceId: options.traceId ?? crypto.randomUUID(),
    generationId: options.generationId ?? crypto.randomUUID(),
    prompt: options.prompt,
    startedAt: options.startedAt,
    model: options.model,
    provider: options.provider,
    metadata: options.metadata,
    tools: [],
  };
}

export function recordCodingAgentToolStart(
  turn: CodingAgentTurn,
  event: CodingAgentToolStart,
): OpenCodingAgentTurn {
  const open = requireOpen(turn);
  if (open.tools.some((tool) => tool.toolUseId === event.toolUseId)) {
    return open;
  }
  return {
    ...open,
    tools: [
      ...open.tools,
      {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
        startedAt: event.startedAt,
      },
    ],
  };
}

export function recordCodingAgentToolResult(
  turn: CodingAgentTurn,
  event: CodingAgentToolResult,
): OpenCodingAgentTurn {
  const open = requireOpen(turn);
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId,
  );
  const completed: CodingAgentToolCall = {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    input:
      event.input ??
      (existingIndex >= 0 ? open.tools[existingIndex].input : undefined),
    output: event.output,
    error: failureMessage(event.error) ?? undefined,
    startedAt:
      existingIndex >= 0 ? open.tools[existingIndex].startedAt : event.endedAt,
    endedAt: event.endedAt,
    startTimeMissing:
      existingIndex >= 0
        ? open.tools[existingIndex].startTimeMissing
        : true,
  };
  if (existingIndex < 0) {
    return { ...open, tools: [...open.tools, completed] };
  }
  const tools = [...open.tools];
  tools[existingIndex] = completed;
  return { ...open, tools };
}

export function completeCodingAgentTurn(
  turn: CodingAgentTurn,
  event: CompleteCodingAgentTurnOptions,
): CompletedCodingAgentTurn {
  if (turn.status === "completed") return turn;
  const tools = turn.tools.map((tool) => {
    const error = failureMessage(tool.error) ?? undefined;
    return tool.endedAt
      ? { ...tool, error }
      : {
          ...tool,
          error: error ?? MISSING_TOOL_RESULT_ERROR,
          endedAt: event.endedAt,
          resultMissing: true,
        };
  });
  return {
    ...turn,
    tools,
    status: "completed",
    response: event.response,
    endedAt: event.endedAt,
    model: event.model ?? turn.model,
    provider: event.provider ?? turn.provider,
  };
}

export function codingAgentTurnTrace(
  turn: CompletedCodingAgentTurn,
): CodingAgentTurnTrace {
  const attributes = harnessAttributes(turn);
  const context = new TraceContext({
    id: turn.traceId,
    name: `${turn.harness} coding agent`,
    input: turn.prompt,
    output: turn.response,
    threadId: turn.sessionId,
    startedAt: turn.startedAt,
    metadata: {
      ...(turn.metadata ?? {}),
      ...attributes,
    },
  });

  for (const tool of turn.tools) {
    const missingStart =
      tool.startTimeMissing === true || tool.startedAt === undefined;
    const missingResult =
      tool.resultMissing === true || tool.endedAt === undefined;
    const error = missingResult
      ? (tool.error ?? MISSING_TOOL_RESULT_ERROR)
      : tool.error;
    context.recordTool({
      id: tool.toolUseId,
      name: tool.toolName,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      error,
      status: error == null ? "OK" : "ERROR",
      startedAt: tool.startedAt ?? tool.endedAt ?? turn.endedAt,
      endedAt: tool.endedAt ?? turn.endedAt,
      attributes,
      metadata: {
        tool_use_id: tool.toolUseId,
        ...(missingStart ? { start_time_missing: true } : {}),
        ...(missingResult ? { result_missing: true } : {}),
      },
    });
  }

  context.recordGeneration({
    id: turn.generationId,
    name: `${turn.harness} response`,
    input: turn.prompt,
    output: turn.response,
    model: turn.model,
    llmProvider: turn.provider,
    llmInputMessages: [{ role: "user", content: turn.prompt }],
    llmOutputMessages: [{ role: "assistant", content: turn.response }],
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    attributes,
  });

  return {
    context,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
  };
}
