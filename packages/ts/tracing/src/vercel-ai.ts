import {
  Lemma,
  type LemmaClientOptions,
  type SpanHandle,
  type TraceContext,
  type TraceHandle,
} from "./client";
import { toolResultError } from "./tool-result";

type MaybePromise<T> = T | PromiseLike<T>;

type VercelAIModelCallStartEvent = {
  callId: string;
  provider: string;
  modelId: string;
  messages?: unknown[];
  tools?: ReadonlyArray<Record<string, unknown>>;
};

type VercelAIModelCallEndEvent = {
  callId: string;
  provider: string;
  modelId: string;
  content: ReadonlyArray<unknown>;
  performance: {
    responseTimeMs?: number;
  };
};

type VercelAIEndEvent = {
  text?: string;
  content?: ReadonlyArray<unknown>;
  functionId?: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
};

type VercelAIToolExecutionEndEvent = {
  callId?: string;
  toolCall: {
    toolCallId?: string;
    toolName: string;
    input?: unknown;
  };
  toolExecutionMs?: number;
  toolOutput:
    | {
        type: "tool-result";
        output?: unknown;
      }
    | {
        type: "tool-error";
        error?: unknown;
      };
};

type VercelAIToolExecutionStartEvent = {
  callId?: string;
  toolCall: {
    toolCallId?: string;
    toolName: string;
    input?: unknown;
  };
};

type VercelAIStepStartEvent = {
  callId: string;
  provider: string;
  modelId: string;
  stepNumber: number;
  messages?: unknown[];
  tools?: unknown;
  functionId?: string;
  metadata?: Record<string, unknown>;
};

type VercelAIStepEndEvent = {
  callId: string;
  stepNumber: number;
  model: VercelAIV6ModelInfo;
  text?: string;
  content?: ReadonlyArray<unknown>;
  performance?: {
    stepTimeMs?: number;
    responseTimeMs?: number;
    toolExecutionMs?: Readonly<Record<string, number>>;
  };
  toolCalls?: ReadonlyArray<{
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
  }>;
  error?: unknown;
};

type VercelAIV6ModelInfo = {
  provider: string;
  modelId: string;
};

type VercelAIV6StepStartEvent = {
  stepNumber: number;
  model: VercelAIV6ModelInfo;
  messages?: unknown[];
  tools?: unknown;
  functionId?: string;
  metadata?: Record<string, unknown>;
};

type VercelAIV6StepFinishEvent = {
  stepNumber: number;
  model: VercelAIV6ModelInfo;
  text?: string;
  content?: ReadonlyArray<unknown>;
  functionId?: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
};

type VercelAIV6StartEvent = {
  model: VercelAIV6ModelInfo;
  system?: string;
  prompt?: string | unknown[];
  messages?: unknown[];
  tools?: unknown;
  functionId?: string;
  metadata?: Record<string, unknown>;
};

type VercelAIV6FinishEvent = {
  model: VercelAIV6ModelInfo;
  text?: string;
  content?: ReadonlyArray<unknown>;
  functionId?: string;
  metadata?: Record<string, unknown>;
  error?: unknown;
};

type VercelAIV6ToolCallFinishEvent = {
  toolCall: {
    toolCallId?: string;
    toolName: string;
    input?: unknown;
  };
  durationMs?: number;
} & (
  | {
      success: true;
      output?: unknown;
      error?: never;
    }
  | {
      success: false;
      output?: never;
      error?: unknown;
    }
);

export type VercelAITelemetryIntegration = {
  onLanguageModelCallStart?: (
    event: VercelAIModelCallStartEvent,
  ) => MaybePromise<void>;
  onLanguageModelCallEnd?: (
    event: VercelAIModelCallEndEvent,
  ) => MaybePromise<void>;
  onToolExecutionStart?: (
    event: VercelAIToolExecutionStartEvent,
  ) => MaybePromise<void>;
  onToolCallStart?: (
    event: VercelAIToolExecutionStartEvent,
  ) => MaybePromise<void>;
  onToolExecutionEnd?: (
    event: VercelAIToolExecutionEndEvent,
  ) => MaybePromise<void>;
  onStart?: (event: VercelAIV6StartEvent) => MaybePromise<void>;
  onStepStart?: (
    event: VercelAIStepStartEvent | VercelAIV6StepStartEvent,
  ) => MaybePromise<void>;
  onStepEnd?: (event: VercelAIStepEndEvent) => MaybePromise<void>;
  onStepFinish?: (event: VercelAIV6StepFinishEvent) => MaybePromise<void>;
  onFinish?: (event: VercelAIV6FinishEvent) => MaybePromise<void>;
  onEnd?: (event: VercelAIEndEvent) => MaybePromise<void>;
  onToolCallFinish?: (
    event: VercelAIV6ToolCallFinishEvent,
  ) => MaybePromise<void>;
  /** Mark the active run as failed and end the owned trace. */
  fail: (error: unknown) => Promise<void>;
  /** Await outstanding terminal deliveries. */
  flush: () => Promise<void>;
  /** Flush and reset integration state for short-lived runtimes. */
  shutdown: () => Promise<void>;
};

export type VercelAIIntegrationOptions = {
  trace?: TraceContext;
  lemma?: Lemma;
  apiKey?: LemmaClientOptions["apiKey"];
  projectId?: LemmaClientOptions["projectId"];
  baseUrl?: LemmaClientOptions["baseUrl"];
  fetch?: LemmaClientOptions["fetch"];
  agentName?: string;
  generationName?:
    | string
    | ((
        event:
          | VercelAIModelCallEndEvent
          | VercelAIV6StepFinishEvent
          | VercelAIV6FinishEvent,
      ) => string);
  toolName?:
    | string
    | ((
        event: VercelAIToolExecutionEndEvent | VercelAIV6ToolCallFinishEvent,
      ) => string);
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  /** Key looked up on telemetry metadata for threadId. Default: `threadId`. */
  threadIdKey?: string;
  /** Key looked up on telemetry metadata for userId. Default: `userId`. */
  userIdKey?: string;
};

type StoredModelCall = {
  event: VercelAIModelCallStartEvent;
  startedAt: Date;
  handle?: SpanHandle;
};

type StoredV6Step = {
  event: VercelAIV6StepStartEvent | VercelAIV6StartEvent;
  startedAt: Date;
  handle?: SpanHandle;
  key: string;
};

type StoredV7Step = {
  event: VercelAIStepStartEvent;
  startedAt: Date;
  handle: SpanHandle;
};

type StoredToolExecution = {
  handle: SpanHandle;
  startedAt: Date;
  parentId?: string;
};

type TraceSource = "explicit" | "managed";

type ResolvedTrace = {
  trace: TraceContext;
  source: TraceSource;
};

type TerminalEvent =
  | VercelAIEndEvent
  | VercelAIV6FinishEvent
  | { error?: unknown; text?: string; content?: ReadonlyArray<unknown> };

const CONCURRENT_REUSE_ERROR =
  "vercelAI() is already tracing a run. Create a new vercelAI() integration per concurrent AI SDK operation.";

function addMs(startedAt: Date, durationMs: number | undefined): Date {
  return typeof durationMs === "number"
    ? new Date(startedAt.getTime() + durationMs)
    : new Date();
}

function subtractMs(endedAt: Date, durationMs: number | undefined): Date {
  return typeof durationMs === "number"
    ? new Date(endedAt.getTime() - durationMs)
    : endedAt;
}

function v7StepKey(callId: string, stepNumber: number) {
  return `${callId}:${stepNumber}`;
}

function isV7StepStart(
  event: VercelAIStepStartEvent | VercelAIV6StepStartEvent,
): event is VercelAIStepStartEvent {
  return "callId" in event && "provider" in event && "modelId" in event;
}

function stringifyContent(content: ReadonlyArray<unknown>): string {
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as { type?: unknown }).type !== "text") return "";
      return String((part as { text?: unknown }).text ?? "");
    })
    .join("");
  if (text) return text;
  return JSON.stringify(content);
}

function structuredAssistantOutput(
  text: string | undefined,
  content: ReadonlyArray<unknown> | undefined,
): unknown {
  if (typeof text === "string") return text;
  if (!content) return undefined;
  const hasNonText = content.some(
    (part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type !== "text",
  );
  if (hasNonText) return content;
  return stringifyContent(content);
}

function errorToolFields(error: unknown, recordOutputs: boolean) {
  return recordOutputs
    ? { error, status: "ERROR" as const }
    : { status: "ERROR" as const };
}

function toolOutput(
  event: VercelAIToolExecutionEndEvent,
  recordOutputs: boolean,
) {
  if (event.toolOutput.type === "tool-error") {
    return errorToolFields(event.toolOutput.error, recordOutputs);
  }
  const softError = toolResultError(event.toolOutput.output);
  if (softError) {
    return errorToolFields(softError, recordOutputs);
  }
  if (!recordOutputs) return {};
  return { output: event.toolOutput.output };
}

function v6ToolOutput(
  event: VercelAIV6ToolCallFinishEvent,
  recordOutputs: boolean,
) {
  if (!event.success) {
    return errorToolFields(event.error, recordOutputs);
  }
  const softError = toolResultError(event.output);
  if (softError) {
    return errorToolFields(softError, recordOutputs);
  }
  if (!recordOutputs) return {};
  return { output: event.output };
}

function resolveDurationMs(
  startedAt: Date,
  endedAt: Date,
  reportedMs: number | undefined,
) {
  const wallMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  if (typeof reportedMs !== "number") return wallMs;
  // Prefer wall clock when it is longer so children that finished inside the
  // step cannot outlast a too-short reported model-only duration.
  return Math.max(reportedMs, wallMs);
}

function messageContent(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const record = message as Record<string, unknown>;
  if ("content" in record) return record.content;
  return message;
}

function lookupString(
  sources: Array<Record<string, unknown> | undefined>,
  keys: string[],
): string | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return undefined;
}

/** Normalize v6 system/prompt/messages into a chat message list when possible. */
function v6NormalizedMessages(
  event: VercelAIV6StepStartEvent | VercelAIV6StartEvent,
): unknown[] | undefined {
  if (Array.isArray(event.messages)) return event.messages;

  const messages: Array<{ role: string; content: unknown }> = [];
  if ("system" in event && typeof event.system === "string" && event.system) {
    messages.push({ role: "system", content: event.system });
  }
  if ("prompt" in event && event.prompt !== undefined) {
    if (Array.isArray(event.prompt)) {
      return messages.length > 0
        ? [...messages, ...event.prompt]
        : event.prompt;
    }
    if (typeof event.prompt === "string") {
      messages.push({ role: "user", content: event.prompt });
    }
  }
  return messages.length > 0 ? messages : undefined;
}

function v6Input(event: VercelAIV6StepStartEvent | VercelAIV6StartEvent) {
  const normalized = v6NormalizedMessages(event);
  if (normalized) return normalized;
  if ("prompt" in event) return event.prompt;
  return undefined;
}

/**
 * Prefer the current user turn for the Lemma root input.
 * Accepts a bare string, message array, or prompt/system start payload.
 */
function rootTraceInput(input: unknown): unknown {
  if (typeof input === "string") return input;
  if (!Array.isArray(input) || input.length === 0) return input;

  for (let i = input.length - 1; i >= 0; i--) {
    const message = input[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as Record<string, unknown>).role;
    if (role === "user") return messageContent(message);
  }

  return messageContent(input[input.length - 1]);
}

function eventTraceInput(
  event?:
    | VercelAIV6StartEvent
    | VercelAIStepStartEvent
    | VercelAIV6StepStartEvent
    | VercelAIModelCallStartEvent,
) {
  if (!event) return undefined;
  if ("messages" in event || "prompt" in event || "system" in event) {
    if (!("callId" in event) || "model" in event) {
      return v6Input(event as VercelAIV6StartEvent | VercelAIV6StepStartEvent);
    }
  }
  if ("messages" in event && event.messages) return event.messages;
  if ("prompt" in event) return (event as VercelAIV6StartEvent).prompt;
  return undefined;
}

function eventMetadata(
  event?:
    | VercelAIV6StartEvent
    | VercelAIModelCallStartEvent
    | VercelAIStepStartEvent
    | VercelAIV6StepStartEvent
    | VercelAIV6FinishEvent
    | VercelAIV6StepFinishEvent
    | VercelAIEndEvent,
): Record<string, unknown> | undefined {
  return event && "metadata" in event ? (event.metadata ?? undefined) : undefined;
}

function traceName(
  options: VercelAIIntegrationOptions,
  event?:
    | VercelAIV6StartEvent
    | VercelAIModelCallStartEvent
    | VercelAIStepStartEvent
    | VercelAIV6StepStartEvent
    | VercelAIV6FinishEvent
    | VercelAIV6StepFinishEvent
    | VercelAIEndEvent,
) {
  if (options.agentName) return options.agentName;
  const functionId =
    event && "functionId" in event && typeof event.functionId === "string"
      ? event.functionId
      : undefined;
  return functionId || "vercel-ai-agent";
}

function v6Output(event: VercelAIV6StepFinishEvent | VercelAIV6FinishEvent) {
  return structuredAssistantOutput(event.text, event.content);
}

function endOutput(event: TerminalEvent) {
  return structuredAssistantOutput(event.text, event.content);
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function vercelAI(
  options: VercelAIIntegrationOptions = {},
): VercelAITelemetryIntegration {
  let lemma = options.lemma;
  const pending = new Set<Promise<void>>();

  // One integration object owns one in-flight run. Terminal delivery resets
  // the run for sequential reuse; overlapping starts fail fast because AI SDK
  // terminal events do not carry a reliable run ID.
  type RunPhase = "idle" | "active" | "ending";
  let phase: RunPhase = "idle";
  let modelCalls = new Map<string, StoredModelCall>();
  let v7Steps = new Map<string, StoredV7Step>();
  let v6Steps = new Map<string, StoredV6Step>();
  let v6Starts: StoredV6Step[] = [];
  let generationSpanIdsByCallId = new Map<string, string>();
  let generationSpanIdsByToolCallId = new Map<string, string>();
  let generationHandlesById = new Map<string, SpanHandle>();
  let toolExecutions = new Map<string, StoredToolExecution>();
  let latestV6GenerationId: string | undefined;
  let managedTrace: TraceHandle | undefined;
  let recordedV6Step = false;
  let sawV7StepZero = false;
  let runStartedAt: Date | undefined;
  let runError: string | undefined;
  let endingTrace:
    | {
        fail: (error: unknown) => void;
        output: (value: unknown) => void;
      }
    | undefined;

  function resetRunState() {
    phase = "idle";
    modelCalls = new Map();
    v7Steps = new Map();
    v6Steps = new Map();
    v6Starts = [];
    generationSpanIdsByCallId = new Map();
    generationSpanIdsByToolCallId = new Map();
    generationHandlesById = new Map();
    toolExecutions = new Map();
    latestV6GenerationId = undefined;
    managedTrace = undefined;
    recordedV6Step = false;
    sawV7StepZero = false;
    runStartedAt = undefined;
    runError = undefined;
    endingTrace = undefined;
  }

  function trackGeneration(handle: SpanHandle) {
    generationHandlesById.set(handle.id, handle);
  }

  function coverParent(parentId: string | undefined, endedAt: Date) {
    if (!parentId) return;
    generationHandlesById.get(parentId)?.ensureEndedAt(endedAt);
  }

  function getLemma() {
    lemma ??= new Lemma({
      apiKey: options.apiKey,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
    });
    return lemma;
  }

  function resolveThreadId(metadata?: Record<string, unknown>) {
    const key = options.threadIdKey ?? "threadId";
    return lookupString([metadata, options.metadata], [key]);
  }

  function resolveUserId(metadata?: Record<string, unknown>) {
    const key = options.userIdKey ?? "userId";
    return lookupString([metadata, options.metadata], [key]);
  }

  function mergedMetadata(metadata?: Record<string, unknown>) {
    return {
      ...options.metadata,
      ...(metadata ?? {}),
    };
  }

  function beginActivity() {
    if (phase === "idle") {
      phase = "active";
      runStartedAt = new Date();
    }
  }

  function beginNewRun() {
    if (phase === "active" || phase === "ending") {
      throw new Error(CONCURRENT_REUSE_ERROR);
    }
    resetRunState();
    phase = "active";
    runStartedAt = new Date();
  }

  function hasExplicitEndableTrace() {
    const trace = options.trace as
      | (TraceContext & { end?: unknown })
      | undefined;
    return Boolean(trace && typeof trace.end === "function");
  }

  function applyIdentity(
    trace: TraceContext,
    metadata?: Record<string, unknown>,
  ) {
    const threadId = resolveThreadId(metadata);
    const userId = resolveUserId(metadata);
    if (threadId) trace.threadId(threadId);
    if (userId) trace.userId(userId);
  }

  function rootErrorPayload(message: string) {
    // Preserve ERROR status while redacting message bodies when outputs are off.
    return options.recordOutputs === false ? "error" : message;
  }

  function resolveTrace(
    event?:
      | VercelAIV6StartEvent
      | VercelAIStepStartEvent
      | VercelAIV6StepStartEvent
      | VercelAIModelCallStartEvent,
  ): ResolvedTrace | null {
    // Trailing AI SDK callbacks can arrive while terminal delivery is in flight.
    // Attach them to the still-open trace instead of throwing.
    if (phase === "ending") {
      const trace = options.trace ?? managedTrace;
      return trace
        ? {
            trace,
            source: options.trace ? "explicit" : "managed",
          }
        : null;
    }

    beginActivity();
    const metadata = eventMetadata(event);
    if (options.trace) {
      applyIdentity(options.trace, metadata);
      return { trace: options.trace, source: "explicit" };
    }
    if (!managedTrace) {
      const rawInput =
        options.recordInputs === false ? undefined : eventTraceInput(event);
      managedTrace = getLemma().trace({
        name: traceName(options, event),
        input:
          options.recordInputs === false
            ? undefined
            : rootTraceInput(rawInput),
        metadata: mergedMetadata(metadata),
        threadId: resolveThreadId(metadata),
        userId: resolveUserId(metadata),
        startedAt: runStartedAt,
      });
    } else {
      applyIdentity(managedTrace, metadata);
      if (options.recordInputs !== false && event) {
        const rawInput = eventTraceInput(event);
        if (rawInput !== undefined) {
          // Keep root input as the latest known current-turn value.
          managedTrace.input(rootTraceInput(rawInput));
        }
      }
    }
    return { trace: managedTrace, source: "managed" };
  }

  function trackPending(promise: Promise<void>) {
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
    return promise;
  }

  async function endOwnedTrace(event: TerminalEvent) {
    if (phase === "idle") return;
    if (phase === "ending") return;
    phase = "ending";

    const trace = options.trace as
      | (TraceContext & {
          end?: (outputOrOptions?: unknown) => MaybePromise<void>;
        })
      | undefined;
    let ownedTrace:
      | {
          end: (outputOrOptions?: unknown) => MaybePromise<void>;
          fail: (error: unknown) => void;
          output: (value: unknown) => void;
        }
      | undefined;
    if (trace && typeof trace.end === "function") {
      ownedTrace = {
        end: trace.end.bind(trace),
        fail: trace.fail.bind(trace),
        output: trace.output.bind(trace),
      };
    } else if (managedTrace) {
      ownedTrace = managedTrace;
    }

    const identityTrace = (options.trace ?? managedTrace) as
      | TraceContext
      | undefined;
    if (identityTrace) {
      applyIdentity(
        identityTrace,
        eventMetadata(event as VercelAIEndEvent | VercelAIV6FinishEvent),
      );
    }

    const eventError =
      "error" in event && event.error != null
        ? errorMessage(event.error)
        : undefined;
    if (eventError && !runError) {
      runError = eventError;
    }

    const endedAt = new Date();
    const startedAt = runStartedAt ?? endedAt;
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const successOutput = endOutput(event);

    endingTrace = ownedTrace;

    const endPromise = (async () => {
      try {
        if (!ownedTrace) return;
        // Yield so a racing fail()/trailing callback in this turn can settle.
        await Promise.resolve();
        const terminalError = runError;
        if (terminalError) {
          ownedTrace.fail(rootErrorPayload(terminalError));
          ownedTrace.output(undefined);
          await ownedTrace.end({ durationMs, endedAt });
          return;
        }
        if (options.recordOutputs === false || successOutput === undefined) {
          await ownedTrace.end({ durationMs, endedAt });
        } else {
          await ownedTrace.end({
            output: successOutput,
            durationMs,
            endedAt,
          });
        }
      } finally {
        // Fully reset so the same integration object can be reused sequentially.
        resetRunState();
      }
    })();

    await trackPending(endPromise);
  }

  function recordV6Generation(
    event: VercelAIV6StepFinishEvent | VercelAIV6FinishEvent,
    stored: StoredV6Step | undefined,
  ) {
    const resolved = resolveTrace(stored?.event);
    if (!resolved) return;
    const { trace } = resolved;

    const startedAt = stored?.startedAt ?? new Date();
    const endedAt = new Date();
    const durationMs = resolveDurationMs(startedAt, endedAt, undefined);
    const id = crypto.randomUUID();
    const name =
      typeof options.generationName === "function"
        ? options.generationName(event)
        : (options.generationName ?? "vercel-ai-generation");
    const output = v6Output(event);
    const generationError =
      "error" in event && event.error != null
        ? errorMessage(event.error)
        : undefined;

    const generation = {
      name,
      input:
        options.recordInputs === false
          ? undefined
          : stored?.event && v6Input(stored.event),
      output:
        options.recordOutputs === false || generationError
          ? undefined
          : output,
      metadata: options.metadata,
      model: event.model.modelId,
      startedAt,
      endedAt,
      durationMs,
      llmProvider: event.model.provider,
      llmInputMessages:
        options.recordInputs === false || !stored?.event
          ? undefined
          : v6NormalizedMessages(stored.event),
      llmOutputMessages:
        options.recordOutputs === false ||
        output === undefined ||
        generationError
          ? undefined
          : [{ role: "assistant", content: output }],
      llmTools: stored?.event.tools,
      status: generationError ? ("ERROR" as const) : undefined,
      error: options.recordOutputs === false ? undefined : generationError,
    };

    if (stored?.handle) {
      stored.handle.end(generation);
      latestV6GenerationId = stored.handle.id;
      trackGeneration(stored.handle);
      return;
    }

    trace.recordGeneration({
      id,
      ...generation,
    });
    latestV6GenerationId = id;
  }

  function startV7Generation(event: VercelAIStepStartEvent) {
    if (event.stepNumber === 0) {
      if (sawV7StepZero && phase === "active") {
        throw new Error(CONCURRENT_REUSE_ERROR);
      }
      sawV7StepZero = true;
    }
    const resolved = resolveTrace(event);
    if (!resolved) return;
    const { trace } = resolved;

    const name =
      typeof options.generationName === "function"
        ? options.generationName({
            callId: event.callId,
            provider: event.provider,
            modelId: event.modelId,
            content: [],
            performance: {},
          })
        : (options.generationName ?? "vercel-ai-generation");
    const startedAt = new Date();
    const handle = trace.startGeneration({
      name,
      input: options.recordInputs === false ? undefined : event.messages,
      metadata: options.metadata,
      model: event.modelId,
      startedAt,
      llmProvider: event.provider,
      llmInputMessages:
        options.recordInputs === false ? undefined : event.messages,
      llmTools: event.tools,
    });

    const stored = { event, startedAt, handle };
    v7Steps.set(v7StepKey(event.callId, event.stepNumber), stored);
    generationSpanIdsByCallId.set(event.callId, handle.id);
    trackGeneration(handle);
  }

  function startV6Generation(
    event: VercelAIV6StepStartEvent | VercelAIV6StartEvent,
    key: string,
  ): StoredV6Step | undefined {
    const resolved = resolveTrace(event);
    if (!resolved) return undefined;
    const { trace } = resolved;
    const startedAt = new Date();
    const name =
      typeof options.generationName === "function"
        ? options.generationName({
            stepNumber: "stepNumber" in event ? event.stepNumber : 0,
            model: event.model,
          })
        : (options.generationName ?? "vercel-ai-generation");
    const input = v6Input(event);
    const handle = trace.startGeneration({
      name,
      input: options.recordInputs === false ? undefined : input,
      metadata: options.metadata,
      model: event.model.modelId,
      startedAt,
      llmProvider: event.model.provider,
      llmInputMessages:
        options.recordInputs === false
          ? undefined
          : v6NormalizedMessages(event),
      llmTools: event.tools,
    });

    latestV6GenerationId = handle.id;
    trackGeneration(handle);
    return { event, startedAt, handle, key };
  }

  function endV7Generation(event: VercelAIStepEndEvent) {
    const key = v7StepKey(event.callId, event.stepNumber);
    const stored = v7Steps.get(key);
    v7Steps.delete(key);
    if (!stored) return;

    const endedAt = new Date();
    const durationMs = resolveDurationMs(
      stored.startedAt,
      endedAt,
      event.performance?.stepTimeMs ?? event.performance?.responseTimeMs,
    );
    const output = structuredAssistantOutput(event.text, event.content);
    const generationError =
      event.error != null ? errorMessage(event.error) : undefined;

    for (const toolCall of event.toolCalls ?? []) {
      if (toolCall.toolCallId) {
        generationSpanIdsByToolCallId.set(
          toolCall.toolCallId,
          stored.handle.id,
        );
      }
    }

    stored.handle.end({
      output:
        options.recordOutputs === false || generationError
          ? undefined
          : output,
      model: event.model.modelId,
      durationMs,
      endedAt: addMs(stored.startedAt, durationMs),
      llmProvider: event.model.provider,
      llmOutputMessages:
        options.recordOutputs === false ||
        output === undefined ||
        generationError
          ? undefined
          : [{ role: "assistant", content: output }],
      status: generationError ? ("ERROR" as const) : undefined,
      error: options.recordOutputs === false ? undefined : generationError,
    });
  }

  function resolveToolParentId(callId?: string, toolCallId?: string) {
    return (
      (toolCallId && generationSpanIdsByToolCallId.get(toolCallId)) ||
      (callId ? generationSpanIdsByCallId.get(callId) : undefined) ||
      latestV6GenerationId
    );
  }

  const integration: VercelAITelemetryIntegration = {
    onLanguageModelCallStart(event) {
      if (
        phase === "active" &&
        generationSpanIdsByCallId.size > 0 &&
        !generationSpanIdsByCallId.has(event.callId)
      ) {
        const belongsToActiveStep = [...v7Steps.values()].some(
          (step) => step.event.callId === event.callId,
        );
        // Multi-step v7 registers the next callId on step start before the
        // model callback. Any other new callId is concurrent reuse.
        if (!belongsToActiveStep) {
          throw new Error(CONCURRENT_REUSE_ERROR);
        }
      }

      const resolved = resolveTrace(event);
      if (!resolved) return;
      const { trace } = resolved;
      if (generationSpanIdsByCallId.has(event.callId)) {
        modelCalls.set(event.callId, { event, startedAt: new Date() });
        return;
      }

      const startedAt = new Date();
      const name =
        typeof options.generationName === "function"
          ? options.generationName({
              callId: event.callId,
              provider: event.provider,
              modelId: event.modelId,
              content: [],
              performance: {},
            })
          : (options.generationName ?? "vercel-ai-generation");
      const handle = trace.startGeneration({
        name,
        input: options.recordInputs === false ? undefined : event.messages,
        metadata: options.metadata,
        model: event.modelId,
        startedAt,
        llmProvider: event.provider,
        llmInputMessages:
          options.recordInputs === false ? undefined : event.messages,
        llmTools: event.tools,
      });

      modelCalls.set(event.callId, { event, startedAt, handle });
      generationSpanIdsByCallId.set(event.callId, handle.id);
      trackGeneration(handle);
    },

    onLanguageModelCallEnd(event) {
      if (phase !== "active" && phase !== "ending") return;
      const stored = modelCalls.get(event.callId);
      modelCalls.delete(event.callId);
      if (!stored?.handle) return;

      const endedAt = new Date();
      const durationMs = resolveDurationMs(
        stored.startedAt,
        endedAt,
        event.performance.responseTimeMs,
      );
      const output = structuredAssistantOutput(undefined, event.content);
      stored.handle.end({
        output: options.recordOutputs === false ? undefined : output,
        model: event.modelId,
        durationMs,
        endedAt: addMs(stored.startedAt, durationMs),
        llmProvider: event.provider,
        llmOutputMessages:
          options.recordOutputs === false || output === undefined
            ? undefined
            : [{ role: "assistant", content: output }],
      });
    },

    onToolExecutionStart(event) {
      const resolved = resolveTrace();
      if (!resolved) return;
      const { trace } = resolved;

      const parentId = resolveToolParentId(
        event.callId,
        event.toolCall.toolCallId,
      );
      const name =
        typeof options.toolName === "function"
          ? options.toolName({
              ...event,
              toolExecutionMs: undefined,
              toolOutput: { type: "tool-result" },
            })
          : (options.toolName ?? event.toolCall.toolName);
      const startedAt = new Date();
      const handle = trace.startTool({
        name,
        parentId,
        input:
          options.recordInputs === false ? undefined : event.toolCall.input,
        metadata: options.metadata,
        startedAt,
        toolName: event.toolCall.toolName,
      });

      if (event.toolCall.toolCallId) {
        toolExecutions.set(event.toolCall.toolCallId, {
          handle,
          startedAt,
          parentId,
        });
      }
    },

    onToolCallStart(event) {
      integration.onToolExecutionStart?.(event);
    },

    onToolExecutionEnd(event) {
      const resolved = resolveTrace();
      if (!resolved) return;
      const { trace } = resolved;

      const name =
        typeof options.toolName === "function"
          ? options.toolName(event)
          : (options.toolName ?? event.toolCall.toolName);
      const storedTool = event.toolCall.toolCallId
        ? toolExecutions.get(event.toolCall.toolCallId)
        : undefined;
      if (event.toolCall.toolCallId) {
        toolExecutions.delete(event.toolCall.toolCallId);
      }

      if (storedTool) {
        const endedAt = addMs(storedTool.startedAt, event.toolExecutionMs);
        const durationMs = resolveDurationMs(
          storedTool.startedAt,
          endedAt,
          event.toolExecutionMs,
        );
        storedTool.handle.end({
          durationMs,
          endedAt: addMs(storedTool.startedAt, durationMs),
          toolName: event.toolCall.toolName,
          ...toolOutput(event, options.recordOutputs !== false),
        });
        coverParent(
          storedTool.parentId,
          addMs(storedTool.startedAt, durationMs),
        );
        return;
      }

      const endedAt = new Date();
      const startedAt = subtractMs(endedAt, event.toolExecutionMs);
      const durationMs = resolveDurationMs(
        startedAt,
        endedAt,
        event.toolExecutionMs,
      );
      const parentId = resolveToolParentId(
        event.callId,
        event.toolCall.toolCallId,
      );

      trace.recordTool({
        name,
        parentId,
        toolName: event.toolCall.toolName,
        input:
          options.recordInputs === false ? undefined : event.toolCall.input,
        metadata: options.metadata,
        durationMs,
        startedAt: subtractMs(endedAt, durationMs),
        endedAt,
        ...toolOutput(event, options.recordOutputs !== false),
      });
      coverParent(parentId, endedAt);
    },

    onStart(event) {
      beginNewRun();
      recordedV6Step = false;
      const key = `start:${v6Starts.length}:${Date.now()}`;
      v6Starts.push({ event, startedAt: new Date(), key });
      resolveTrace(event);
    },

    onStepStart(event) {
      if (isV7StepStart(event)) {
        startV7Generation(event);
        return;
      }
      const key = `step:${event.stepNumber}`;
      if (v6Steps.has(key)) {
        // Duplicate step start for the same step number — ignore.
        return;
      }
      const stored = startV6Generation(event, key);
      if (stored) v6Steps.set(key, stored);
    },

    onStepEnd(event) {
      if (phase !== "active" && phase !== "ending") return;
      endV7Generation(event);
    },

    onStepFinish(event) {
      if (phase !== "active" && phase !== "ending") return;
      recordedV6Step = true;
      const key = `step:${event.stepNumber}`;
      const stored = v6Steps.get(key);
      v6Steps.delete(key);
      recordV6Generation(event, stored);
    },

    async onFinish(event) {
      if (phase === "idle") {
        // Terminal-only path for an explicit trace handle with no prior events.
        if (!hasExplicitEndableTrace()) return;
        beginActivity();
      }
      if (phase === "active") {
        if (recordedV6Step) {
          v6Starts.shift();
          recordedV6Step = false;
        } else {
          recordV6Generation(event, v6Starts.shift());
        }
      }
      await endOwnedTrace(event);
    },

    async onEnd(event) {
      if (phase === "idle") {
        if (!hasExplicitEndableTrace()) return;
        beginActivity();
      }
      await endOwnedTrace(event);
    },

    onToolCallFinish(event) {
      const resolved = resolveTrace();
      if (!resolved) return;
      const { trace } = resolved;

      const name =
        typeof options.toolName === "function"
          ? options.toolName(event)
          : (options.toolName ?? event.toolCall.toolName);
      const storedTool = event.toolCall.toolCallId
        ? toolExecutions.get(event.toolCall.toolCallId)
        : undefined;
      if (event.toolCall.toolCallId) {
        toolExecutions.delete(event.toolCall.toolCallId);
      }
      if (storedTool) {
        const endedAt = addMs(storedTool.startedAt, event.durationMs);
        const durationMs = resolveDurationMs(
          storedTool.startedAt,
          endedAt,
          event.durationMs,
        );
        const toolEndedAt = addMs(storedTool.startedAt, durationMs);
        storedTool.handle.end({
          durationMs,
          endedAt: toolEndedAt,
          toolName: event.toolCall.toolName,
          ...v6ToolOutput(event, options.recordOutputs !== false),
        });
        coverParent(storedTool.parentId, toolEndedAt);
        return;
      }

      const endedAt = new Date();
      const durationMs = resolveDurationMs(
        subtractMs(endedAt, event.durationMs),
        endedAt,
        event.durationMs,
      );
      const startedAt = subtractMs(endedAt, durationMs);
      const parentId = resolveToolParentId(
        undefined,
        event.toolCall.toolCallId,
      );

      trace.recordTool({
        name,
        parentId,
        toolName: event.toolCall.toolName,
        input:
          options.recordInputs === false ? undefined : event.toolCall.input,
        metadata: options.metadata,
        durationMs,
        startedAt,
        endedAt,
        ...v6ToolOutput(event, options.recordOutputs !== false),
      });
      coverParent(parentId, endedAt);
    },

    async fail(error) {
      const message = errorMessage(error);
      runError = message;
      if (phase === "ending") {
        // Best-effort: apply before the in-flight terminal send reads error state.
        endingTrace?.fail(rootErrorPayload(message));
        endingTrace?.output(undefined);
        return;
      }
      if (phase === "idle") {
        beginActivity();
      }
      await endOwnedTrace({ error });
    },

    async flush() {
      await Promise.all(Array.from(pending));
    },

    async shutdown() {
      if (phase === "active") {
        await endOwnedTrace({});
      }
      await integration.flush();
      resetRunState();
    },
  };

  return integration;
}

export type LemmaVercelAIIntegrationOptions = VercelAIIntegrationOptions;
