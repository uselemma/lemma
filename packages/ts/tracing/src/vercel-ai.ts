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

function v6Input(event: VercelAIV6StepStartEvent | VercelAIV6StartEvent) {
  if ("messages" in event && event.messages) return event.messages;
  return "prompt" in event ? event.prompt : undefined;
}

function traceInput(
  event?:
    | VercelAIV6StartEvent
    | VercelAIStepStartEvent
    | VercelAIV6StepStartEvent
    | VercelAIModelCallStartEvent,
) {
  if (!event) return undefined;
  if ("messages" in event && event.messages) return event.messages;
  if ("prompt" in event) return event.prompt;
  return undefined;
}

function traceMetadata(
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
  return {
    ...options.metadata,
    ...(event && "metadata" in event ? (event.metadata ?? {}) : {}),
  };
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

function v6InputMessages(
  event: VercelAIV6StepStartEvent | VercelAIV6StartEvent,
) {
  const input = v6Input(event);
  return Array.isArray(input) ? input : undefined;
}

function v6Output(event: VercelAIV6StepFinishEvent | VercelAIV6FinishEvent) {
  if (typeof event.text === "string") return event.text;
  if (event.content) return stringifyContent(event.content);
  return undefined;
}

export function vercelAI(
  options: VercelAIIntegrationOptions = {},
): VercelAITelemetryIntegration {
  let lemma = options.lemma;
  const modelCalls = new Map<string, StoredModelCall>();
  const v7Steps = new Map<string, StoredV7Step>();
  const v6Steps = new Map<number, StoredV6Step>();
  const v6Starts: StoredV6Step[] = [];
  const generationSpanIdsByCallId = new Map<string, string>();
  const generationSpanIdsByToolCallId = new Map<string, string>();
  const generationHandlesById = new Map<string, SpanHandle>();
  const toolExecutions = new Map<string, StoredToolExecution>();
  let managedTrace: TraceHandle | undefined;
  let recordedV6Step = false;
  let endedExplicitTrace = false;
  let endedManagedTrace = false;

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

  function resolveTrace(
    event?:
      | VercelAIV6StartEvent
      | VercelAIStepStartEvent
      | VercelAIV6StepStartEvent
      | VercelAIModelCallStartEvent,
  ): ResolvedTrace {
    if (options.trace) return { trace: options.trace, source: "explicit" };
    if (!managedTrace) {
      managedTrace = getLemma().trace({
        name: traceName(options, event),
        input: options.recordInputs === false ? undefined : traceInput(event),
        metadata: traceMetadata(options, event),
      });
    }
    return { trace: managedTrace, source: "managed" };
  }

  function endOutput(event: VercelAIEndEvent | VercelAIV6FinishEvent) {
    if (typeof event.text === "string") return event.text;
    if (event.content) return stringifyContent(event.content);
    return undefined;
  }

  async function endOwnedTrace(
    event: VercelAIEndEvent | VercelAIV6FinishEvent,
  ) {
    const trace = options.trace as
      | (TraceContext & {
          end?: (outputOrOptions?: unknown) => MaybePromise<void>;
        })
      | undefined;
    let ownedTrace:
      | {
          trace: { end: (outputOrOptions?: unknown) => MaybePromise<void> };
          explicit: boolean;
        }
      | undefined;
    if (trace && typeof trace.end === "function") {
      ownedTrace = { trace: { end: trace.end.bind(trace) }, explicit: true };
    } else if (managedTrace) {
      ownedTrace = { trace: managedTrace, explicit: false };
    }
    if (!ownedTrace) return;
    if (ownedTrace.explicit) {
      if (endedExplicitTrace) return;
      endedExplicitTrace = true;
    } else {
      if (endedManagedTrace) return;
      endedManagedTrace = true;
    }
    const output = endOutput(event);
    if (options.recordOutputs === false || output === undefined) {
      await ownedTrace.trace.end();
      return;
    }
    await ownedTrace.trace.end({ output });
  }

  function recordV6Generation(
    event: VercelAIV6StepFinishEvent | VercelAIV6FinishEvent,
    stored: StoredV6Step | undefined,
  ) {
    const { trace } = resolveTrace(stored?.event);

    const startedAt = stored?.startedAt ?? new Date();
    const endedAt = new Date();
    const durationMs = resolveDurationMs(startedAt, endedAt, undefined);
    const id = crypto.randomUUID();
    const name =
      typeof options.generationName === "function"
        ? options.generationName(event)
        : (options.generationName ?? "vercel-ai-generation");
    const output = v6Output(event);

    const generation = {
      name,
      input:
        options.recordInputs === false
          ? undefined
          : stored?.event && v6Input(stored.event),
      output: options.recordOutputs === false ? undefined : output,
      metadata: options.metadata,
      model: event.model.modelId,
      startedAt,
      endedAt,
      durationMs,
      llmProvider: event.model.provider,
      llmInputMessages:
        options.recordInputs === false || !stored?.event
          ? undefined
          : v6InputMessages(stored.event),
      llmOutputMessages:
        options.recordOutputs === false || output === undefined
          ? undefined
          : [{ role: "assistant", content: output }],
      llmTools: stored?.event.tools,
    };

    if (stored?.handle) {
      stored.handle.end(generation);
      generationSpanIdsByCallId.set("v6-latest", stored.handle.id);
      trackGeneration(stored.handle);
      return;
    }

    trace.recordGeneration({
      id,
      ...generation,
    });
    generationSpanIdsByCallId.set("v6-latest", id);
  }

  function startV7Generation(event: VercelAIStepStartEvent) {
    const { trace } = resolveTrace(event);

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
  ): StoredV6Step {
    const { trace } = resolveTrace(event);
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
        options.recordInputs === false ? undefined : v6InputMessages(event),
      llmTools: event.tools,
    });

    generationSpanIdsByCallId.set("v6-latest", handle.id);
    trackGeneration(handle);
    return { event, startedAt, handle };
  }

  function endV7Generation(event: VercelAIStepEndEvent) {
    const stored = v7Steps.get(v7StepKey(event.callId, event.stepNumber));
    v7Steps.delete(v7StepKey(event.callId, event.stepNumber));
    if (!stored) return;

    const endedAt = new Date();
    const durationMs = resolveDurationMs(
      stored.startedAt,
      endedAt,
      event.performance?.stepTimeMs ?? event.performance?.responseTimeMs,
    );
    const output =
      typeof event.text === "string"
        ? event.text
        : event.content
          ? stringifyContent(event.content)
          : undefined;

    for (const toolCall of event.toolCalls ?? []) {
      if (toolCall.toolCallId) {
        generationSpanIdsByToolCallId.set(
          toolCall.toolCallId,
          stored.handle.id,
        );
      }
    }

    stored.handle.end({
      output: options.recordOutputs === false ? undefined : output,
      model: event.model.modelId,
      durationMs,
      endedAt: addMs(stored.startedAt, durationMs),
      llmProvider: event.model.provider,
      llmOutputMessages:
        options.recordOutputs === false || output === undefined
          ? undefined
          : [{ role: "assistant", content: output }],
    });
  }

  return {
    onLanguageModelCallStart(event) {
      const { trace } = resolveTrace(event);
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
      const stored = modelCalls.get(event.callId);
      modelCalls.delete(event.callId);
      if (!stored?.handle) return;

      const endedAt = new Date();
      const durationMs = resolveDurationMs(
        stored.startedAt,
        endedAt,
        event.performance.responseTimeMs,
      );
      stored.handle.end({
        output:
          options.recordOutputs === false
            ? undefined
            : stringifyContent(event.content),
        model: event.modelId,
        durationMs,
        endedAt: addMs(stored.startedAt, durationMs),
        llmProvider: event.provider,
        llmOutputMessages:
          options.recordOutputs === false
            ? undefined
            : [{ role: "assistant", content: stringifyContent(event.content) }],
      });
    },

    onToolExecutionStart(event) {
      const { trace } = resolveTrace();

      const parentId =
        (event.toolCall.toolCallId &&
          generationSpanIdsByToolCallId.get(event.toolCall.toolCallId)) ||
        (event.callId
          ? generationSpanIdsByCallId.get(event.callId)
          : generationSpanIdsByCallId.get("v6-latest"));
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
      this.onToolExecutionStart?.(event);
    },

    onToolExecutionEnd(event) {
      const { trace } = resolveTrace();

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
          ...toolOutput(event, options.recordOutputs !== false),
        });
        coverParent(storedTool.parentId, addMs(storedTool.startedAt, durationMs));
        return;
      }

      const endedAt = new Date();
      const startedAt = subtractMs(endedAt, event.toolExecutionMs);
      const durationMs = resolveDurationMs(
        startedAt,
        endedAt,
        event.toolExecutionMs,
      );
      const parentId =
        (event.toolCall.toolCallId &&
          generationSpanIdsByToolCallId.get(event.toolCall.toolCallId)) ||
        (event.callId
          ? generationSpanIdsByCallId.get(event.callId)
          : generationSpanIdsByCallId.get("v6-latest"));

      trace.recordTool({
        name,
        parentId,
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
      recordedV6Step = false;
      v6Starts.push({ event, startedAt: new Date() });
      resolveTrace(event);
    },

    onStepStart(event) {
      if (isV7StepStart(event)) {
        startV7Generation(event);
        return;
      }
      v6Steps.set(event.stepNumber, startV6Generation(event));
    },

    onStepEnd(event) {
      endV7Generation(event);
    },

    onStepFinish(event) {
      recordedV6Step = true;
      const stored = v6Steps.get(event.stepNumber);
      v6Steps.delete(event.stepNumber);
      recordV6Generation(event, stored);
    },

    async onFinish(event) {
      if (recordedV6Step) {
        v6Starts.shift();
        recordedV6Step = false;
        await endOwnedTrace(event);
        return;
      }
      recordV6Generation(event, v6Starts.shift());
      await endOwnedTrace(event);
    },

    async onEnd(event) {
      await endOwnedTrace(event);
    },

    onToolCallFinish(event) {
      const { trace } = resolveTrace();

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
      const parentId =
        (event.toolCall.toolCallId &&
          generationSpanIdsByToolCallId.get(event.toolCall.toolCallId)) ||
        generationSpanIdsByCallId.get("v6-latest");

      trace.recordTool({
        name,
        parentId,
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
  };
}

export type LemmaVercelAIIntegrationOptions = VercelAIIntegrationOptions;
