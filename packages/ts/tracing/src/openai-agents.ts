import { Lemma, type SpanHandle, type TraceHandle } from "./client";
import { toolResultError } from "./tool-result";

export type OpenAIAgentsTrace = {
  traceId: string;
  name: string;
  groupId?: string | null;
  metadata?: Record<string, unknown>;
};

export type OpenAIAgentsSpanData = {
  type: string;
  [key: string]: unknown;
};

export type OpenAIAgentsSpan = {
  traceId: string;
  spanId: string;
  parentId?: string | null;
  spanData: OpenAIAgentsSpanData;
  traceMetadata?: Record<string, unknown>;
  startedAt?: string | null;
  endedAt?: string | null;
  error?: {
    message?: string;
    data?: Record<string, unknown>;
  } | null;
};

export type OpenAIAgentsTracingProcessor = {
  start?: () => void;
  onTraceStart: (trace: OpenAIAgentsTrace) => Promise<void>;
  onTraceEnd: (trace: OpenAIAgentsTrace) => Promise<void>;
  onSpanStart: (span: OpenAIAgentsSpan) => Promise<void>;
  onSpanEnd: (span: OpenAIAgentsSpan) => Promise<void>;
  shutdown: (timeout?: number) => Promise<void>;
  forceFlush: () => Promise<void>;
};

export type OpenAIAgentsIntegrationOptions = {
  lemma?: Lemma;
  apiKey?: string;
  projectId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  /** Key looked up on trace/span metadata for threadId. Default: `threadId`. */
  threadIdKey?: string;
  /** Key looked up on trace/span metadata for userId. Default: `userId`, then `resourceId`. */
  userIdKey?: string;
};

type StoredTrace = {
  handle: TraceHandle;
  ended: boolean;
  rootInput?: unknown;
  rootOutput?: unknown;
  rootError?: string;
  earliestStart?: Date;
  latestEnd?: Date;
};

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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

function messageContent(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const record = message as Record<string, unknown>;
  if ("content" in record) return record.content;
  return message;
}

/** Prefer the current user turn for the Lemma root input. */
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

function textFromGenerationOutput(output: unknown) {
  if (!Array.isArray(output)) return output;
  const text = output
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      if (typeof record["text"] === "string") return record["text"];
      if (typeof record["content"] === "string") return record["content"];
      return "";
    })
    .join("");
  return text || output;
}

function responseOutput(data: OpenAIAgentsSpanData): unknown {
  const response = data["response"] ?? data["_response"];
  if (response == null) {
    return textFromGenerationOutput(data["output"]);
  }
  if (typeof response === "object" && response !== null) {
    const record = response as Record<string, unknown>;
    if (typeof record.output_text === "string") return record.output_text;
    if (Array.isArray(record.output)) {
      return textFromGenerationOutput(record.output);
    }
    return response;
  }
  return response;
}

function spanName(data: OpenAIAgentsSpanData): string {
  if (typeof data["name"] === "string" && data["name"]) {
    return data["name"];
  }
  if (data.type === "generation") return "openai-agents-generation";
  if (data.type === "response") return "openai-agents-response";
  if (data.type === "agent") return "openai-agents-agent";
  if (data.type === "guardrail") return "openai-agents-guardrail";
  if (data.type === "handoff") {
    const from =
      typeof data["from_agent"] === "string" ? data["from_agent"] : "";
    const to = typeof data["to_agent"] === "string" ? data["to_agent"] : "";
    return from && to ? `${from} to ${to}` : "openai-agents-handoff";
  }
  if (data.type === "speech" || data.type === "transcription") {
    return `openai-agents-${data.type}`;
  }
  if (data.type === "mcp_tools") return "openai-agents-mcp-tools";
  return `openai-agents-${data.type || "span"}`;
}

function openAIAttributes(span: OpenAIAgentsSpan): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      "openai.agents.trace_id": span.traceId,
      "openai.agents.span_id": span.spanId,
      "openai.agents.parent_id": span.parentId,
      "openai.agents.span_type": span.spanData.type,
      "openai.agents.trace_metadata": span.traceMetadata
        ? JSON.stringify(span.traceMetadata)
        : undefined,
      "openai.agents.span_data": JSON.stringify(span.spanData),
    }).filter(([, value]) => value !== undefined && value !== null),
  );
}

function coerceDate(value: string | Date | null | undefined): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function startedAt(span: OpenAIAgentsSpan) {
  return coerceDate(span.startedAt) ?? new Date();
}

function endedAt(span: OpenAIAgentsSpan) {
  return coerceDate(span.endedAt) ?? new Date();
}

function durationMs(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime());
}

function spanInput(data: OpenAIAgentsSpanData): unknown {
  return parseMaybeJson(data["input"] ?? data["_input"]);
}

function isGenerationType(type: string) {
  return type === "generation" || type === "response";
}

function isTerminalFailureType(type: string) {
  return (
    type === "agent" ||
    type === "task" ||
    type === "custom" ||
    type === "guardrail"
  );
}

export function openAIAgents(
  options: OpenAIAgentsIntegrationOptions = {},
): OpenAIAgentsTracingProcessor {
  const lemma =
    options.lemma ??
    new Lemma({
      apiKey: options.apiKey,
      projectId: options.projectId,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
    });
  const traces = new Map<string, StoredTrace>();
  const spans = new Map<string, { handle: SpanHandle; traceId: string }>();
  /** Ended handles kept only until their trace finalizes (for parent extend). */
  const endedSpans = new Map<string, { handle: SpanHandle; traceId: string }>();

  function resolveThreadId(
    groupId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (typeof groupId === "string" && groupId) return groupId;
    const key = options.threadIdKey ?? "threadId";
    return lookupString([metadata, options.metadata], [key, "thread_id"]);
  }

  function resolveUserId(metadata?: Record<string, unknown>) {
    if (options.userIdKey) {
      return lookupString([metadata, options.metadata], [options.userIdKey]);
    }
    return lookupString(
      [metadata, options.metadata],
      ["userId", "user_id", "resourceId"],
    );
  }

  function applyIdentity(
    stored: StoredTrace,
    groupId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    const threadId = resolveThreadId(groupId, metadata);
    const userId = resolveUserId(metadata);
    if (threadId) stored.handle.threadId(threadId);
    if (userId) stored.handle.userId(userId);
  }

  function noteBounds(stored: StoredTrace, start?: Date, end?: Date) {
    if (start) {
      stored.earliestStart =
        !stored.earliestStart || start < stored.earliestStart
          ? start
          : stored.earliestStart;
    }
    if (end) {
      stored.latestEnd =
        !stored.latestEnd || end > stored.latestEnd ? end : stored.latestEnd;
    }
  }

  function noteRootInput(stored: StoredTrace, input: unknown) {
    if (options.recordInputs === false) return;
    if (input == null) return;
    if (stored.rootInput !== undefined) return;
    stored.rootInput = rootTraceInput(input);
    stored.handle.input(stored.rootInput);
  }

  function noteRootOutput(stored: StoredTrace, output: unknown) {
    if (options.recordOutputs === false) return;
    if (output == null || stored.rootError) return;
    stored.rootOutput = output;
  }

  function noteRootError(stored: StoredTrace, error: string | undefined) {
    if (!error || stored.rootError) return;
    stored.rootError = error;
  }

  function ensureTrace(trace: OpenAIAgentsTrace): StoredTrace {
    const existing = traces.get(trace.traceId);
    if (existing) {
      applyIdentity(existing, trace.groupId, trace.metadata);
      return existing;
    }

    const handle = lemma.trace({
      name: trace.name || "openai-agents-trace",
      metadata: {
        ...options.metadata,
        ...(trace.metadata ?? {}),
        openaiAgentsTraceId: trace.traceId,
        openaiAgentsGroupId: trace.groupId ?? undefined,
      },
      threadId: resolveThreadId(trace.groupId, trace.metadata),
      userId: resolveUserId(trace.metadata),
    });
    const stored: StoredTrace = { handle, ended: false };
    traces.set(trace.traceId, stored);
    return stored;
  }

  function startSpan(span: OpenAIAgentsSpan): SpanHandle | undefined {
    const trace = traces.get(span.traceId);
    if (!trace) return undefined;

    applyIdentity(trace, undefined, span.traceMetadata);
    const data = span.spanData;
    const input = spanInput(data);
    if (isGenerationType(data.type)) {
      noteRootInput(trace, input);
    }

    const spanStartedAt = startedAt(span);
    noteBounds(trace, spanStartedAt, undefined);

    const base = {
      id: span.spanId,
      parentId: span.parentId ?? null,
      name: spanName(data),
      input: options.recordInputs === false ? undefined : input,
      metadata: options.metadata,
      attributes: openAIAttributes(span),
      startedAt: spanStartedAt,
    };

    if (isGenerationType(data.type)) {
      return trace.handle.startGeneration({
        ...base,
        model: typeof data["model"] === "string" ? data["model"] : undefined,
        llmProvider: "openai",
        llmInputMessages:
          options.recordInputs === false || !Array.isArray(input)
            ? undefined
            : (input as unknown[]),
        llmInvocationParameters: data["model_config"],
      });
    }

    if (data.type === "function") {
      return trace.handle.startTool({
        ...base,
        toolName: typeof data["name"] === "string" ? data["name"] : undefined,
      });
    }

    return trace.handle.startSpan(base);
  }

  function endSpan(span: OpenAIAgentsSpan) {
    const storedTrace = traces.get(span.traceId);
    const handle = spans.get(span.spanId)?.handle ?? startSpan(span);
    if (!handle || !storedTrace) return;
    spans.delete(span.spanId);

    applyIdentity(storedTrace, undefined, span.traceMetadata);
    const data = span.spanData;
    const input = spanInput(data);
    if (isGenerationType(data.type)) {
      noteRootInput(storedTrace, input);
    }

    // Parse outputs for soft-error detection even when payloads are not recorded.
    let rawOutput: unknown;
    if (data.type === "generation") {
      rawOutput = textFromGenerationOutput(data["output"]);
    } else if (data.type === "response") {
      rawOutput = responseOutput(data);
    } else {
      rawOutput = parseMaybeJson(data["output"] ?? data["_response"]);
    }

    const softError =
      data.type === "function" ? toolResultError(rawOutput) : null;
    const hardError = span.error?.message;
    const errorMessage = hardError ?? softError ?? undefined;
    const parsedOutput =
      options.recordOutputs === false || errorMessage ? undefined : rawOutput;
    const spanStartedAt = startedAt(span);
    const spanEndedAt = endedAt(span);
    noteBounds(storedTrace, spanStartedAt, spanEndedAt);

    // Root failure only from hard terminal/agent/task/guardrail errors — not
    // recovered child soft tool errors when a later generation succeeds.
    if (hardError && isTerminalFailureType(data.type)) {
      noteRootError(storedTrace, hardError);
    }
    if (!errorMessage && isGenerationType(data.type) && parsedOutput != null) {
      noteRootOutput(storedTrace, parsedOutput);
    }

    handle.end({
      // Failures must not invent an output — record error instead.
      output: parsedOutput,
      error: options.recordOutputs === false ? undefined : errorMessage,
      status: errorMessage ? "ERROR" : undefined,
      model: typeof data["model"] === "string" ? data["model"] : undefined,
      endedAt: spanEndedAt,
      durationMs: durationMs(spanStartedAt, spanEndedAt),
      llmOutputMessages:
        errorMessage ||
        options.recordOutputs === false ||
        data.type !== "generation" ||
        !Array.isArray(data["output"])
          ? undefined
          : (data["output"] as unknown[]),
    });
    endedSpans.set(span.spanId, { handle, traceId: span.traceId });

    // Tools that finish after their parent generation must not outlast it.
    if (span.parentId && data.type === "function") {
      const parent =
        spans.get(span.parentId)?.handle ??
        endedSpans.get(span.parentId)?.handle;
      parent?.ensureEndedAt(spanEndedAt);
    }
  }

  function forgetTraceSpans(traceId: string) {
    for (const [spanId, entry] of endedSpans) {
      if (entry.traceId === traceId) endedSpans.delete(spanId);
    }
    for (const [spanId, entry] of spans) {
      if (entry.traceId === traceId) spans.delete(spanId);
    }
  }

  // Deliver a trace exactly once and drop it, so a later shutdown/forceFlush (or
  // a duplicate onTraceEnd) can't re-send a completed trace and duplicate its
  // spans. Sending happens only here, via the handle's terminal end().
  async function finalizeTrace(traceId: string, stored: StoredTrace) {
    traces.delete(traceId);
    forgetTraceSpans(traceId);
    if (stored.ended) return;
    stored.ended = true;

    const endedAtValue = stored.latestEnd ?? new Date();
    const startedAtValue = stored.earliestStart ?? endedAtValue;
    const rootDuration = durationMs(startedAtValue, endedAtValue);

    const timing = {
      startedAt: startedAtValue,
      endedAt: endedAtValue,
      durationMs: rootDuration,
    };

    if (stored.rootError) {
      stored.handle.fail(
        options.recordOutputs === false ? "error" : stored.rootError,
      );
      await stored.handle.end(timing);
      return;
    }

    if (options.recordOutputs === false || stored.rootOutput === undefined) {
      await stored.handle.end(timing);
      return;
    }

    await stored.handle.end({
      output: stored.rootOutput,
      ...timing,
    });
  }

  async function finalizeAll() {
    await Promise.all(
      Array.from(traces.entries(), ([traceId, stored]) =>
        finalizeTrace(traceId, stored),
      ),
    );
  }

  return {
    onTraceStart: async (trace) => {
      ensureTrace(trace);
    },
    onTraceEnd: async (trace) => {
      // Look up (don't ensure) so a trace already finalized by forceFlush /
      // shutdown isn't recreated and sent a second time.
      const stored = traces.get(trace.traceId);
      if (!stored) return;
      applyIdentity(stored, trace.groupId, trace.metadata);
      await finalizeTrace(trace.traceId, stored);
    },
    onSpanStart: async (span) => {
      // Repair missing parents only when the owning trace is already known.
      if (!traces.has(span.traceId)) return;
      const handle = startSpan(span);
      if (handle) spans.set(span.spanId, { handle, traceId: span.traceId });
    },
    onSpanEnd: async (span) => {
      if (!traces.has(span.traceId)) return;
      endSpan(span);
    },
    // Shutdown/forceFlush finalize any still-open traces (a one-time terminal
    // send for traces that never received onTraceEnd), then drop them.
    shutdown: async () => {
      await finalizeAll();
    },
    forceFlush: async () => {
      await finalizeAll();
    },
  };
}
