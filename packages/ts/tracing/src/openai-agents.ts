import { Lemma, type SpanHandle, type TraceHandle } from "./client";

type MaybePromise<T> = T | PromiseLike<T>;

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
};

type StoredTrace = {
  handle: TraceHandle;
  ended: boolean;
};

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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

function spanName(data: OpenAIAgentsSpanData): string {
  if (typeof data["name"] === "string" && data["name"]) {
    return data["name"];
  }
  if (data.type === "generation") return "openai-agents-generation";
  if (data.type === "response") return "openai-agents-response";
  if (data.type === "handoff") {
    const from =
      typeof data["from_agent"] === "string" ? data["from_agent"] : "";
    const to = typeof data["to_agent"] === "string" ? data["to_agent"] : "";
    return from && to ? `${from} to ${to}` : "openai-agents-handoff";
  }
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

function startedAt(span: OpenAIAgentsSpan) {
  return span.startedAt ?? new Date();
}

function endedAt(span: OpenAIAgentsSpan) {
  return span.endedAt ?? new Date();
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
  const spans = new Map<string, SpanHandle>();

  function ensureTrace(trace: OpenAIAgentsTrace): StoredTrace {
    const existing = traces.get(trace.traceId);
    if (existing) return existing;

    const handle = lemma.trace({
      name: trace.name || "openai-agents-trace",
      metadata: {
        ...options.metadata,
        ...(trace.metadata ?? {}),
        openaiAgentsTraceId: trace.traceId,
        openaiAgentsGroupId: trace.groupId ?? undefined,
      },
      threadId: trace.groupId ?? undefined,
    });
    const stored = { handle, ended: false };
    traces.set(trace.traceId, stored);
    return stored;
  }

  function startSpan(span: OpenAIAgentsSpan): SpanHandle | undefined {
    const trace = traces.get(span.traceId);
    if (!trace) return undefined;

    const data = span.spanData;
    const base = {
      id: span.spanId,
      parentId: span.parentId ?? null,
      name: spanName(data),
      input:
        options.recordInputs === false
          ? undefined
          : parseMaybeJson(data["input"] ?? data["_input"]),
      metadata: options.metadata,
      attributes: openAIAttributes(span),
      startedAt: startedAt(span),
    };

    if (data.type === "generation" || data.type === "response") {
      return trace.handle.startGeneration({
        ...base,
        model: typeof data["model"] === "string" ? data["model"] : undefined,
        llmProvider: "openai",
        llmInputMessages:
          options.recordInputs === false || !Array.isArray(data["input"])
            ? undefined
            : (data["input"] as unknown[]),
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
    const handle = spans.get(span.spanId) ?? startSpan(span);
    if (!handle) return;
    spans.delete(span.spanId);

    const data = span.spanData;
    const output =
      options.recordOutputs === false
        ? undefined
        : data.type === "generation"
          ? textFromGenerationOutput(data["output"])
          : parseMaybeJson(data["output"] ?? data["_response"]);
    handle.end({
      output,
      error: span.error?.message,
      status: span.error ? "ERROR" : undefined,
      model: typeof data["model"] === "string" ? data["model"] : undefined,
      endedAt: endedAt(span),
      llmOutputMessages:
        options.recordOutputs === false || !Array.isArray(data["output"])
          ? undefined
          : (data["output"] as unknown[]),
    });
  }

  // Deliver a trace exactly once and drop it, so a later shutdown/forceFlush (or
  // a duplicate onTraceEnd) can't re-send a completed trace and duplicate its
  // spans. Sending happens only here, via the handle's terminal end().
  async function finalizeTrace(traceId: string, stored: StoredTrace) {
    traces.delete(traceId);
    if (stored.ended) return;
    stored.ended = true;
    await stored.handle.end();
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
      const stored = traces.get(trace.traceId) ?? ensureTrace(trace);
      await finalizeTrace(trace.traceId, stored);
    },
    onSpanStart: async (span) => {
      const handle = startSpan(span);
      if (handle) spans.set(span.spanId, handle);
    },
    onSpanEnd: async (span) => {
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
