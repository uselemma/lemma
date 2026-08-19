import { createHash } from "node:crypto";

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
  generationStartedAt?: string;
  generationEndedAt?: string;
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
  /** Exact model-call bounds. Omit both when the harness does not expose them. */
  generationStartedAt?: string;
  generationEndedAt?: string;
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

function deterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  const variant = (8 + (Number.parseInt(hash[16], 16) % 4)).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function turnIdentity(options: StartCodingAgentTurnOptions): string {
  return `${options.harness}\0${options.sessionId}\0${options.turnId}`;
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
    traceId:
      options.traceId ??
      deterministicUuid(`lemma-coding-agent-trace\0${turnIdentity(options)}`),
    generationId:
      options.generationId ??
      deterministicUuid(
        `lemma-coding-agent-generation\0${turnIdentity(options)}`,
      ),
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
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId,
  );
  if (existingIndex >= 0) {
    const existing = open.tools[existingIndex];
    if (!existing.startTimeMissing) return open;
    const tools = [...open.tools];
    tools[existingIndex] = {
      ...existing,
      toolName: event.toolName,
      input: event.input === undefined ? existing.input : event.input,
      startedAt: event.startedAt,
      startTimeMissing: undefined,
    };
    return { ...open, tools };
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
      event.input === undefined && existingIndex >= 0
        ? open.tools[existingIndex].input
        : event.input,
    output: event.output,
    error: failureMessage(event.error) ?? undefined,
    startedAt:
      existingIndex >= 0 ? open.tools[existingIndex].startedAt : undefined,
    endedAt: event.endedAt,
    startTimeMissing:
      existingIndex >= 0 ? open.tools[existingIndex].startTimeMissing : true,
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
  if (
    (event.generationStartedAt === undefined) !==
    (event.generationEndedAt === undefined)
  ) {
    throw new Error(
      "Coding agent generation timing requires both startedAt and endedAt",
    );
  }
  const tools = turn.tools.map((tool) => {
    const error = failureMessage(tool.error) ?? undefined;
    return tool.endedAt
      ? { ...tool, error }
      : { ...tool, error, resultMissing: true };
  });
  return {
    ...turn,
    tools,
    status: "completed",
    response: event.response,
    endedAt: event.endedAt,
    model: event.model ?? turn.model,
    provider: event.provider ?? turn.provider,
    generationStartedAt: event.generationStartedAt,
    generationEndedAt: event.generationEndedAt,
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
    const error = tool.error;
    context.recordTool({
      id: tool.toolUseId,
      name: tool.toolName,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      error,
      status: error == null ? (missingResult ? undefined : "OK") : "ERROR",
      startedAt: tool.startedAt ?? null,
      endedAt: tool.endedAt ?? null,
      attributes,
      metadata: {
        tool_use_id: tool.toolUseId,
        ...(missingStart ? { start_time_missing: true } : {}),
        ...(missingResult ? { result_missing: true } : {}),
      },
    });
  }

  const generationTimingMissing = turn.generationStartedAt === undefined;
  context.recordGeneration({
    id: turn.generationId,
    name: `${turn.harness} response`,
    input: turn.prompt,
    output: turn.response,
    model: turn.model,
    llmProvider: turn.provider,
    llmInputMessages: [{ role: "user", content: turn.prompt }],
    llmOutputMessages: [{ role: "assistant", content: turn.response }],
    startedAt: turn.generationStartedAt ?? null,
    endedAt: turn.generationEndedAt ?? null,
    attributes,
    metadata: generationTimingMissing ? { timing_missing: true } : undefined,
  });

  return {
    context,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
  };
}
