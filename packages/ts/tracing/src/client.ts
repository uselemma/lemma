import {
  apiKeySuffix,
  buildConfigWarnings,
  EXPECTED_INGEST_SUCCESS_STATUS,
  type IngestStatus,
  ingestFailureHint,
  INGEST_PATH,
  INGEST_STATUS_PATH,
  INGEST_STATUS_POLL_INTERVAL_MS,
  INGEST_STATUS_POLL_TIMEOUT_MS,
  isSuccessfulIngestStatus,
  parseIngestStatus,
  pickResponseHeaders,
  sleep,
} from "./debug-delivery";
import { isDebugModeEnabled, isDebugVerifyEnabled, lemmaDebug } from "./debug-mode";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LemmaClientOptions = {
  apiKey?: string;
  projectId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type DebugSmokeTestResult = {
  ok: boolean;
  config: {
    baseUrl: string;
    projectId: string;
    apiKeySuffix: string;
    ingestPath: string;
    expectedSuccessStatus: number;
    warnings: string[];
  };
  ingest?: {
    status: number;
    traceId: string;
    projectId: string;
    url: string;
    responseHeaders: Record<string, string>;
    warnings: string[];
  };
  /** Per-trace ingest pipeline status after the smoke ingest. */
  ingestStatus?: IngestStatus;
  hints: string[];
};

export type TraceOptions = {
  id?: string;
  name?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  threadId?: string;
  userId?: string;
  environment?: string;
};

export type TraceEndOptions = {
  output?: unknown;
  durationMs?: number;
};

export type SpanType = "span" | "generation" | "tool";

export type SpanOptions = {
  id?: string;
  parentId?: string | null;
  parentSpanId?: string | null;
  name: string;
  type?: SpanType;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  startedAt?: Date | string;
  endedAt?: Date | string | null;
  durationMs?: number;
  status?: "OK" | "ERROR";
  error?: unknown;
  model?: string;
  toolName?: string;
  inputMimeType?: string;
  outputMimeType?: string;
  llmModelName?: string;
  llmProvider?: string;
  llmSystem?: string;
  llmInvocationParameters?: unknown;
  llmInputMessages?: unknown[];
  llmOutputMessages?: unknown[];
  llmTools?: unknown;
  llmPromptTemplate?: string;
  llmPromptTemplateVariables?: unknown;
  llmPromptTemplateVersion?: string;
  toolDescription?: string;
  toolParameters?: unknown;
  embeddingModelName?: string;
  embeddingInvocationParameters?: unknown;
  embeddingEmbeddings?: unknown;
  rerankerModelName?: string;
  rerankerInputDocuments?: unknown[];
  rerankerOutputDocuments?: unknown[];
};

export type GenerationOptions = Omit<SpanOptions, "type" | "toolName">;
export type ToolOptions = Omit<SpanOptions, "type" | "model">;

export type DetachedSpanOptions = Partial<SpanOptions> & { traceId?: string };
export type DetachedGenerationOptions = Partial<GenerationOptions> & {
  traceId?: string;
  parentSpanId?: string | null;
};
export type DetachedToolOptions = Partial<ToolOptions> & {
  traceId?: string;
  parentSpanId?: string | null;
};

type SdkTraceSpanPayload = {
  id?: string;
  parent_id?: string | null;
  name: string;
  type: SpanType;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  started_at?: string;
  ended_at?: string | null;
  duration_ms?: number;
  status?: "OK" | "ERROR";
  error?: string | null;
  model?: string;
  tool_name?: string;
};

type SdkTracePayload = {
  project_id: string;
  trace: {
    id?: string;
    name: string;
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
    thread_id?: string;
    user_id?: string;
    environment?: string;
    started_at: string;
    ended_at?: string | null;
    duration_ms?: number;
    status?: "OK" | "ERROR";
    error?: string | null;
    spans: SdkTraceSpanPayload[];
  };
  replace?: boolean;
};

type DebugSpanSummary = {
  index?: number;
  id?: string;
  parentId?: string | null;
  name: string;
  type: SpanType;
  status?: "OK" | "ERROR";
  durationMs?: number;
  model?: string;
  hasInput: boolean;
  hasOutput: boolean;
  hasError: boolean;
};

function required(value: string | undefined, envName: string): string {
  if (value?.trim()) return value.trim();
  throw new Error(`@uselemma/tracing: Missing ${envName}`);
}

function iso(
  value: Date | string | null | undefined,
): string | null | undefined {
  if (value == null) return value;
  return value instanceof Date ? value.toISOString() : value;
}

function errorMessage(error: unknown): string | null {
  if (error == null) return null;
  return error instanceof Error ? error.message : String(error);
}

function timestampMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function elapsedMs(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): number | undefined {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (startMs == null || endMs == null) return undefined;
  return Math.max(0, endMs - startMs);
}

function summarizeSpanForDebug(
  span: SdkTraceSpanPayload,
  index?: number,
): DebugSpanSummary {
  return Object.fromEntries(
    Object.entries({
      index,
      id: span.id,
      parentId: span.parent_id,
      name: span.name,
      type: span.type,
      status: span.status,
      durationMs: span.duration_ms,
      model: span.model,
      hasInput: span.input !== undefined,
      hasOutput: span.output !== undefined,
      hasError: Boolean(span.error),
    }).filter(([, value]) => value !== undefined),
  ) as DebugSpanSummary;
}

function serializeAttribute(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function addDefined(
  attributes: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value !== undefined) attributes[key] = value;
}

function flattenMessage(
  attributes: Record<string, unknown>,
  prefix: string,
  message: unknown,
) {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    for (const [key, value] of Object.entries(
      message as Record<string, unknown>,
    )) {
      addDefined(
        attributes,
        `${prefix}.message.${key}`,
        serializeAttribute(value),
      );
    }
    return;
  }
  addDefined(
    attributes,
    `${prefix}.message.content`,
    serializeAttribute(message),
  );
}

function flattenDocument(
  attributes: Record<string, unknown>,
  prefix: string,
  document: unknown,
) {
  if (document && typeof document === "object" && !Array.isArray(document)) {
    for (const [key, value] of Object.entries(
      document as Record<string, unknown>,
    )) {
      addDefined(
        attributes,
        `${prefix}.document.${key}`,
        serializeAttribute(value),
      );
    }
    return;
  }
  addDefined(
    attributes,
    `${prefix}.document.content`,
    serializeAttribute(document),
  );
}

function contractAttributes(options: SpanOptions): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  addDefined(attributes, "input.mime_type", options.inputMimeType);
  addDefined(attributes, "output.mime_type", options.outputMimeType);
  addDefined(
    attributes,
    "llm.model_name",
    options.llmModelName ?? options.model,
  );
  addDefined(attributes, "llm.provider", options.llmProvider);
  addDefined(attributes, "llm.system", options.llmSystem);
  addDefined(
    attributes,
    "llm.invocation_parameters",
    serializeAttribute(options.llmInvocationParameters),
  );
  addDefined(attributes, "llm.tools", serializeAttribute(options.llmTools));
  addDefined(
    attributes,
    "llm.prompt_template.template",
    options.llmPromptTemplate,
  );
  addDefined(
    attributes,
    "llm.prompt_template.variables",
    serializeAttribute(options.llmPromptTemplateVariables),
  );
  addDefined(
    attributes,
    "llm.prompt_template.version",
    options.llmPromptTemplateVersion,
  );
  addDefined(attributes, "tool.description", options.toolDescription);
  addDefined(
    attributes,
    "tool.parameters",
    serializeAttribute(options.toolParameters),
  );
  addDefined(attributes, "embedding.model_name", options.embeddingModelName);
  addDefined(
    attributes,
    "embedding.invocation_parameters",
    serializeAttribute(options.embeddingInvocationParameters),
  );
  addDefined(
    attributes,
    "embedding.embeddings",
    serializeAttribute(options.embeddingEmbeddings),
  );
  addDefined(attributes, "reranker.model_name", options.rerankerModelName);

  options.llmInputMessages?.forEach((message, index) => {
    flattenMessage(attributes, `llm.input_messages.${index}`, message);
  });
  options.llmOutputMessages?.forEach((message, index) => {
    flattenMessage(attributes, `llm.output_messages.${index}`, message);
  });
  options.rerankerInputDocuments?.forEach((document, index) => {
    flattenDocument(attributes, `reranker.input_documents.${index}`, document);
  });
  options.rerankerOutputDocuments?.forEach((document, index) => {
    flattenDocument(attributes, `reranker.output_documents.${index}`, document);
  });

  return attributes;
}

function spanAttributes(
  options: SpanOptions,
): Record<string, unknown> | undefined {
  const attributes = {
    ...(options.attributes ?? {}),
    ...contractAttributes(options),
  };
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function normalizeSpan(
  options: SpanOptions,
  fallbackType: SpanType,
): SdkTraceSpanPayload {
  const startedAt = options.startedAt ?? new Date();
  const endedAt = options.endedAt ?? new Date();
  return {
    id: options.id,
    parent_id: options.parentId ?? options.parentSpanId,
    name: options.name,
    type: options.type ?? fallbackType,
    input: options.input,
    output: options.output,
    metadata: options.metadata,
    attributes: spanAttributes(options),
    started_at: iso(startedAt) ?? new Date().toISOString(),
    ended_at: iso(endedAt) ?? new Date().toISOString(),
    duration_ms: options.durationMs,
    status: options.status ?? (options.error ? "ERROR" : undefined),
    error: errorMessage(options.error),
    model: options.model,
    tool_name: options.toolName,
  };
}

function warnNoop(message: string) {
  console.warn(`@uselemma/tracing: ${message}`);
}

function isTraceEndOptions(value: unknown): value is TraceEndOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    ("output" in value || "durationMs" in value)
  );
}

export class SpanHandle {
  readonly id: string;
  private readonly payload: SdkTraceSpanPayload;

  constructor(
    private readonly trace: TraceContext,
    private readonly options: SpanOptions,
    payload?: SdkTraceSpanPayload,
    private ended = false,
  ) {
    this.id = options.id ?? crypto.randomUUID();
    this.payload =
      payload ??
      this.trace.addSpan({
        ...this.options,
        id: this.id,
        startedAt: this.options.startedAt ?? new Date(),
        endedAt: this.options.endedAt ?? null,
      });
  }

  end(options: Omit<SpanOptions, "id" | "name" | "type" | "startedAt"> = {}) {
    if (this.ended) return;
    this.ended = true;
    Object.assign(
      this.payload,
      normalizeSpan(
        {
          ...this.options,
          ...options,
          id: this.id,
          startedAt: this.options.startedAt,
          endedAt: options.endedAt ?? new Date(),
        },
        this.options.type ?? "span",
      ),
    );
    this.trace.spanEnded(this.payload);
    this.trace.changed();
  }

  startSpan(name: string): SpanHandle;
  startSpan(options: Omit<SpanOptions, "endedAt">): SpanHandle;
  startSpan(options: string | Omit<SpanOptions, "endedAt">): SpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.trace.startSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id,
    });
  }

  startGeneration(name: string): SpanHandle;
  startGeneration(
    options: Omit<GenerationOptions, "endedAt" | "type">,
  ): SpanHandle;
  startGeneration(
    options: string | Omit<GenerationOptions, "endedAt" | "type">,
  ): SpanHandle {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    return this.trace.startGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id,
    });
  }

  startTool(name: string): SpanHandle;
  startTool(options: Omit<ToolOptions, "endedAt" | "type">): SpanHandle;
  startTool(
    options: string | Omit<ToolOptions, "endedAt" | "type">,
  ): SpanHandle {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    return this.trace.startTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id,
    });
  }

  recordSpan(name: string): SpanHandle;
  recordSpan(options: SpanOptions): SpanHandle;
  recordSpan(options: string | SpanOptions): SpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.trace.recordSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id,
    });
  }

  recordGeneration(options: string | GenerationOptions) {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    this.trace.recordGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id,
    });
  }

  recordTool(options: string | ToolOptions) {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    this.trace.recordTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id,
    });
  }

  /** @deprecated Use startSpan() or recordSpan(). */
  span(name: string): SpanHandle;
  span(options: SpanOptions): SpanHandle;
  span(options: string | SpanOptions): SpanHandle {
    return typeof options === "string"
      ? this.startSpan(options)
      : this.recordSpan(options);
  }

  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options: string | GenerationOptions) {
    this.recordGeneration(options);
  }

  /** @deprecated Use recordTool() or startTool(). */
  tool(options: string | ToolOptions) {
    this.recordTool(options);
  }
}

export class NoopSpanHandle {
  readonly id = "";

  end() {}

  startSpan(): NoopSpanHandle {
    return this;
  }

  startGeneration(): NoopSpanHandle {
    return this;
  }

  startTool(): NoopSpanHandle {
    return this;
  }

  recordSpan(): NoopSpanHandle {
    return this;
  }

  recordGeneration() {}

  recordTool() {}

  span(): NoopSpanHandle {
    return this;
  }

  generation() {}

  tool() {}
}

export class TraceContext {
  private readonly spans: SdkTraceSpanPayload[] = [];
  private traceOutput: unknown;
  private traceError: string | null = null;
  readonly id: string;

  constructor(
    private readonly options: TraceOptions,
    private onChange?: () => void,
  ) {
    this.options.name ??= "trace";
    this.options.id ??= crypto.randomUUID();
    this.id = this.options.id;
    this.traceOutput = options.output;
  }

  input(value: unknown) {
    this.options.input = value;
    this.changed();
  }

  output(value: unknown) {
    this.traceOutput = value;
    this.changed();
  }

  duration(durationMs: number) {
    this.options.durationMs = durationMs;
    this.changed();
  }

  fail(error: unknown) {
    this.traceError = errorMessage(error);
    this.changed();
  }

  changed() {
    this.onChange?.();
  }

  setChangeHandler(onChange: () => void) {
    this.onChange = onChange;
  }

  private debugSpan(event: string, span: SdkTraceSpanPayload) {
    lemmaDebug("client", event, {
      traceId: this.id,
      span: summarizeSpanForDebug(span),
    });
  }

  addSpan(options: SpanOptions, event = "span started"): SdkTraceSpanPayload {
    const span = normalizeSpan(options, "span");
    this.spans.push(span);
    this.debugSpan(event, span);
    this.changed();
    return span;
  }

  spanEnded(span: SdkTraceSpanPayload) {
    this.debugSpan("span ended", span);
  }

  recordSpan(name: string): SpanHandle;
  recordSpan(options: SpanOptions): SpanHandle;
  recordSpan(options: string | SpanOptions): SpanHandle {
    if (typeof options === "string") {
      return this.startSpan({ name: options });
    }
    const spanId = options.id ?? crypto.randomUUID();
    const span = this.addSpan({ ...options, id: spanId }, "span recorded");
    return new SpanHandle(
      this,
      {
        ...options,
        id: spanId,
        startedAt: span.started_at,
        endedAt: span.ended_at,
      },
      span,
      true,
    );
  }

  recordGeneration(options: string | GenerationOptions) {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    const span = normalizeSpan(
      { ...generationOptions, type: "generation" },
      "generation",
    );
    this.spans.push(span);
    this.debugSpan("span recorded", span);
    this.changed();
  }

  recordTool(options: string | ToolOptions) {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    const span = normalizeSpan({ ...toolOptions, type: "tool" }, "tool");
    this.spans.push(span);
    this.debugSpan("span recorded", span);
    this.changed();
  }

  startSpan(name: string): SpanHandle;
  startSpan(options: Omit<SpanOptions, "endedAt">): SpanHandle;
  startSpan(options: string | Omit<SpanOptions, "endedAt">): SpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return new SpanHandle(this, {
      ...spanOptions,
      id: spanOptions.id ?? crypto.randomUUID(),
      startedAt: spanOptions.startedAt ?? new Date(),
    });
  }

  startGeneration(
    options: Omit<GenerationOptions, "endedAt" | "type">,
  ): SpanHandle {
    return this.startSpan({ ...options, type: "generation" });
  }

  startTool(options: Omit<ToolOptions, "endedAt" | "type">): SpanHandle {
    return this.startSpan({ ...options, type: "tool" });
  }

  /** @deprecated Use startSpan() or recordSpan(). */
  span(name: string): SpanHandle;
  span(options: SpanOptions): SpanHandle;
  span(options: string | SpanOptions): SpanHandle {
    return typeof options === "string"
      ? this.startSpan(options)
      : this.recordSpan(options);
  }

  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options: string | GenerationOptions) {
    this.recordGeneration(options);
  }

  /** @deprecated Use recordTool() or startTool(). */
  tool(options: string | ToolOptions) {
    this.recordTool(options);
  }

  toPayload(
    projectId: string,
    startedAt: Date,
    endedAt: Date,
    replace = false,
  ): SdkTracePayload {
    return {
      project_id: projectId,
      trace: {
        id: this.options.id,
        name: this.options.name ?? "trace",
        input: this.options.input,
        output: this.traceOutput,
        metadata: this.options.metadata,
        thread_id: this.options.threadId,
        user_id: this.options.userId,
        environment: this.options.environment,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: this.options.durationMs ?? elapsedMs(startedAt, endedAt),
        status: this.traceError ? "ERROR" : undefined,
        error: this.traceError,
        spans: this.spans,
      },
      replace,
    };
  }
}

export class TraceHandle extends TraceContext {
  private flushPromise: Promise<void> = Promise.resolve();
  private ended = false;

  constructor(
    options: TraceOptions,
    private readonly flushFn: (
      trace: TraceHandle,
      startedAt: Date,
      endedAt: Date,
    ) => Promise<void>,
    private readonly startedAt = new Date(),
  ) {
    super(options);
    // A trace is delivered only when it is explicitly ended (`end()`) or
    // flushed (`flush()`). We deliberately do NOT auto-send on construction or
    // on every recorded span: the ingest API is append-only and treats each
    // submission's spans as new, so streaming partial snapshots re-sends every
    // prior span and accumulates duplicates. Recording mutates the in-memory
    // trace only; the single terminal send carries the complete trace.
  }

  /**
   * Send the trace's current contents in one request. Prefer `end()`; use
   * `flush()` only when you deliberately want to deliver before ending (each
   * call is a full send, so repeated flushes re-send earlier spans).
   */
  flush() {
    const endedAt = new Date();
    this.flushPromise = this.flushPromise.then(() =>
      this.flushFn(this, this.startedAt, endedAt),
    );
    return this.flushPromise;
  }

  async end(): Promise<void>;
  async end(output: unknown): Promise<void>;
  async end(options: TraceEndOptions): Promise<void>;
  async end(outputOrOptions?: unknown | TraceEndOptions) {
    // Ending is idempotent: a trace is sent exactly once so a second end() (or
    // a shutdown flush after end()) can't duplicate its spans.
    if (this.ended) return this.flushPromise;
    if (isTraceEndOptions(outputOrOptions)) {
      if ("output" in outputOrOptions) {
        this.output(outputOrOptions.output);
      }
      if (outputOrOptions.durationMs != null) {
        this.duration(outputOrOptions.durationMs);
      }
    } else if (arguments.length > 0) {
      this.output(outputOrOptions);
    }
    this.ended = true;
    await this.flush();
  }

  /** Whether this trace has already been delivered via `end()`. */
  get isEnded() {
    return this.ended;
  }
}

export class Lemma {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly traces = new Map<string, TraceHandle>();
  private configLogged = false;

  constructor(options: LemmaClientOptions = {}) {
    this.apiKey = required(
      options.apiKey ?? process.env.LEMMA_API_KEY,
      "LEMMA_API_KEY",
    );
    this.projectId = required(
      options.projectId ?? process.env.LEMMA_PROJECT_ID,
      "LEMMA_PROJECT_ID",
    );
    this.baseUrl = (options.baseUrl ?? "https://api.uselemma.ai").replace(
      /\/+$/,
      "",
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.logInitConfigOnce();
  }

  /**
   * Run a one-call delivery diagnostic: config check, minimal ingest, and
   * per-trace ingest-status poll (enqueued / ingested / ready).
   */
  async debugSmokeTest(): Promise<DebugSmokeTestResult> {
    const configWarnings = buildConfigWarnings(this.baseUrl, this.projectId);
    const hints = [...configWarnings];
    const config = {
      baseUrl: this.baseUrl,
      projectId: this.projectId,
      apiKeySuffix: apiKeySuffix(this.apiKey),
      ingestPath: INGEST_PATH,
      expectedSuccessStatus: EXPECTED_INGEST_SUCCESS_STATUS,
      warnings: configWarnings,
    };

    const traceId = crypto.randomUUID();
    const context = new TraceContext({
      id: traceId,
      name: "lemma-debug-smoke-test",
      input: "smoke-test",
    });
    context.output("ok");
    const startedAt = new Date();
    const payload = context.toPayload(
      this.projectId,
      startedAt,
      new Date(),
      false,
    );
    const body = JSON.stringify(payload);
    const url = `${this.baseUrl}${INGEST_PATH}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      hints.push("ingest request failed (network error)");
      return {
        ok: false,
        config,
        hints,
      };
    }

    const responseHeaders = pickResponseHeaders(response.headers);
    const ingestWarnings: string[] = [];
    if (response.status !== EXPECTED_INGEST_SUCCESS_STATUS) {
      ingestWarnings.push(
        `expected status ${EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status}`,
      );
      const hint = ingestFailureHint(response.status);
      if (hint) hints.push(hint);
    }
    if (!responseHeaders["cf-ray"]) {
      hints.push("missing cf-ray response header (may not be Lemma production)");
    }

    const ingest = {
      status: response.status,
      traceId,
      projectId: this.projectId,
      url,
      responseHeaders,
      warnings: ingestWarnings,
    };

    if (!response.ok) {
      hints.push(`ingest failed with status ${response.status}`);
      return {
        ok: false,
        config,
        ingest,
        hints,
      };
    }

    const ingestStatus = await this.pollIngestStatus(traceId);
    if (ingestStatus === null) {
      hints.push("ingest-status check failed after ingest (status/network)");
    } else if (!isSuccessfulIngestStatus(ingestStatus)) {
      hints.push(
        `ingest returned 201 but ingest-status=not_found after ${INGEST_STATUS_POLL_TIMEOUT_MS / 1000}s — may be processing lag or downstream issue`,
      );
    }

    return {
      ok:
        response.status === EXPECTED_INGEST_SUCCESS_STATUS &&
        isSuccessfulIngestStatus(ingestStatus),
      config,
      ingest,
      ingestStatus: ingestStatus ?? undefined,
      hints,
    };
  }

  trace(): TraceHandle;
  trace(options: TraceOptions | string): TraceHandle;
  trace<T>(
    options: TraceOptions | string,
    fn: (trace: TraceContext) => T | Promise<T>,
  ): Promise<T>;
  trace<T>(
    options: TraceOptions | string = {},
    fn?: (trace: TraceContext) => T | Promise<T>,
  ): TraceHandle | Promise<T> {
    const traceOptions =
      typeof options === "string" ? { name: options } : options;
    if (!fn) {
      const handle = new TraceHandle(
        traceOptions,
        (trace, startedAt, endedAt) =>
          this.flushTrace(trace, startedAt, endedAt, true),
      );
      this.traces.set(handle.id, handle);
      lemmaDebug("client", "trace handle created", {
        traceId: handle.id,
        name: traceOptions.name ?? "trace",
      });
      return handle;
    }
    const context = new TraceContext(traceOptions);
    const startedAt = new Date();
    lemmaDebug("client", "trace started", {
      traceId: context.id,
      name: traceOptions.name ?? "trace",
    });

    return (async () => {
      try {
        const result = await fn(context);
        if (traceOptions.output === undefined) {
          context.output(result);
        }
        await this.flushTrace(context, startedAt, new Date());
        return result;
      } catch (error) {
        context.fail(error);
        await this.flushTrace(context, startedAt, new Date());
        throw error;
      }
    })();
  }

  /**
   * Deliver a trace you assembled yourself, in a single request.
   *
   * This is the manual counterpart to {@link Lemma.trace}: instead of the client
   * owning the lifecycle, you build a {@link TraceContext} — recording spans,
   * output, and status on it — and hand it back to be sent. Use it for producers
   * that live outside a single process (cross-process buffers, queues, batch
   * backfills) where a long-lived handle can't be held.
   *
   * Spans merge into the trace by id when `replace` is false (the default), so a
   * trace can be sent incrementally across several calls; pass `replace: true`
   * to overwrite it wholesale. Throws on a non-2xx response and never mutates the
   * trace's status, so a failed send can be retried as-is.
   */
  async ingest(
    context: TraceContext,
    options: { startedAt: Date; endedAt?: Date; replace?: boolean },
  ): Promise<void> {
    await this.flushTrace(
      context,
      options.startedAt,
      options.endedAt ?? new Date(),
      options.replace ?? false,
    );
  }

  recordSpan(options: DetachedSpanOptions): SpanHandle | NoopSpanHandle {
    const context = this.detachedTraceFor(options.traceId, "span");
    if (!context) return new NoopSpanHandle();
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...spanOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "span has a parent, but parentSpanId was not provided; skipping span",
      );
      return new NoopSpanHandle();
    }
    return context.recordSpan({
      name: "span",
      ...spanOptions,
      parentId: parentSpanId ?? null,
    });
  }

  recordGeneration(options: DetachedGenerationOptions) {
    const context = this.detachedTraceFor(options.traceId, "generation");
    if (!context) return;
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...generationOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "generation has a parent, but parentSpanId was not provided; skipping generation",
      );
      return;
    }
    context.recordGeneration({
      name: "generation",
      ...generationOptions,
      parentId: parentSpanId ?? null,
    });
  }

  recordTool(options: DetachedToolOptions) {
    const context = this.detachedTraceFor(options.traceId, "tool");
    if (!context) return;
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...toolOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "tool has a parent, but parentSpanId was not provided; skipping tool",
      );
      return;
    }
    context.recordTool({
      name: "tool",
      ...toolOptions,
      parentId: parentSpanId ?? null,
    });
  }

  startSpan(options: DetachedSpanOptions): SpanHandle | NoopSpanHandle {
    const context = this.detachedTraceFor(options.traceId, "span");
    if (!context) return new NoopSpanHandle();
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...spanOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "span has a parent, but parentSpanId was not provided; skipping span",
      );
      return new NoopSpanHandle();
    }
    return context.startSpan({
      name: "span",
      ...spanOptions,
      parentId: parentSpanId ?? null,
    });
  }

  startGeneration(
    options: DetachedGenerationOptions,
  ): SpanHandle | NoopSpanHandle {
    const context = this.detachedTraceFor(options.traceId, "generation");
    if (!context) return new NoopSpanHandle();
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...generationOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "generation has a parent, but parentSpanId was not provided; skipping generation",
      );
      return new NoopSpanHandle();
    }
    return context.startGeneration({
      name: "generation",
      ...generationOptions,
      parentId: parentSpanId ?? null,
    });
  }

  startTool(options: DetachedToolOptions): SpanHandle | NoopSpanHandle {
    const context = this.detachedTraceFor(options.traceId, "tool");
    if (!context) return new NoopSpanHandle();
    const {
      traceId: _traceId,
      parentSpanId,
      parentId,
      ...toolOptions
    } = options;
    if (parentId && !parentSpanId) {
      warnNoop(
        "tool has a parent, but parentSpanId was not provided; skipping tool",
      );
      return new NoopSpanHandle();
    }
    return context.startTool({
      name: "tool",
      ...toolOptions,
      parentId: parentSpanId ?? null,
    });
  }

  /** @deprecated Use startSpan() or recordSpan(). */
  span(options: DetachedSpanOptions): SpanHandle | NoopSpanHandle {
    return this.recordSpan(options);
  }

  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options: DetachedGenerationOptions) {
    this.recordGeneration(options);
  }

  /** @deprecated Use recordTool() or startTool(). */
  tool(options: DetachedToolOptions) {
    this.recordTool(options);
  }

  private traceFor(traceId: string): TraceContext {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`@uselemma/tracing: unknown trace id "${traceId}"`);
    }
    return trace;
  }

  private detachedTraceFor(
    traceId: string | undefined,
    kind: string,
  ): TraceContext | null {
    if (!traceId) {
      warnNoop(`${kind} handle requires traceId; skipping ${kind}`);
      return null;
    }
    const trace = this.traces.get(traceId);
    if (!trace) {
      warnNoop(`unknown trace id "${traceId}"; skipping ${kind}`);
      return null;
    }
    return trace;
  }

  private logInitConfigOnce(): void {
    if (!isDebugModeEnabled() || this.configLogged) return;
    this.configLogged = true;
    const warnings = buildConfigWarnings(this.baseUrl, this.projectId);
    lemmaDebug("client", "initialized", {
      baseUrl: this.baseUrl,
      projectId: this.projectId,
      apiKey: apiKeySuffix(this.apiKey),
      ingestPath: INGEST_PATH,
      expectedSuccessStatus: EXPECTED_INGEST_SUCCESS_STATUS,
      ...(warnings.length ? { warnings } : {}),
    });
  }

  private async fetchIngestStatus(
    otelTraceId: string,
  ): Promise<IngestStatus | null> {
    const url =
      `${this.baseUrl}${INGEST_STATUS_PATH}` +
      `?project_id=${encodeURIComponent(this.projectId)}` +
      `&otel_trace_id=${encodeURIComponent(otelTraceId)}`;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        status?: unknown;
      };
      return parseIngestStatus(data.status);
    } catch {
      return null;
    }
  }

  /**
   * Poll ingest-status immediately, then every 1s until success, hard failure,
   * or the 15s timeout.
   */
  private async pollIngestStatus(
    otelTraceId: string,
  ): Promise<IngestStatus | null> {
    const deadline = Date.now() + INGEST_STATUS_POLL_TIMEOUT_MS;
    for (;;) {
      const status = await this.fetchIngestStatus(otelTraceId);
      if (status === null) return null;
      if (isSuccessfulIngestStatus(status)) return status;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return status;
      await sleep(Math.min(INGEST_STATUS_POLL_INTERVAL_MS, remaining));
    }
  }

  private async verifyIngestDelivery(otelTraceId: string): Promise<void> {
    const result = await this.pollIngestStatus(otelTraceId);
    if (result === null) {
      lemmaDebug(
        "verify",
        "ingest accepted (201), ingest-status check failed (status/network)",
      );
      return;
    }
    if (isSuccessfulIngestStatus(result)) {
      lemmaDebug(
        "verify",
        `ingest accepted (201), trace ${result === "enqueued" ? "enqueued" : `visible (${result})`} (status=${result})`,
      );
      return;
    }
    lemmaDebug(
      "verify",
      `ingest accepted (201), ingest-status=not_found after ${INGEST_STATUS_POLL_TIMEOUT_MS / 1000}s — may be processing lag or downstream issue`,
    );
  }

  private async flushTrace(
    context: TraceContext,
    startedAt: Date,
    endedAt: Date,
    replace = false,
  ) {
    const payload = context.toPayload(
      this.projectId,
      startedAt,
      endedAt,
      replace,
    );
    const body = JSON.stringify(payload);
    const url = `${this.baseUrl}${INGEST_PATH}`;
    lemmaDebug("client", "sending trace", {
      traceId: payload.trace.id,
      name: payload.trace.name,
      spanCount: payload.trace.spans.length,
      projectId: payload.project_id,
      bodyBytes: new TextEncoder().encode(body).length,
      requestedAt: new Date().toISOString(),
      url,
      replace,
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    const responseHeaders = pickResponseHeaders(response.headers);

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const hint = ingestFailureHint(response.status);
      lemmaDebug("client", "trace ingest failed", {
        traceId: payload.trace.id,
        projectId: payload.project_id,
        status: response.status,
        body: responseBody,
        ...responseHeaders,
        ...(hint ? { hint } : {}),
      });
      throw new Error(
        `@uselemma/tracing: failed to ingest trace (${response.status})${responseBody ? `: ${responseBody}` : ""}`,
      );
    }

    const sentWarnings: string[] = [];
    if (response.status !== EXPECTED_INGEST_SUCCESS_STATUS) {
      sentWarnings.push(
        `expected status ${EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status} (wrong endpoint?)`,
      );
    }
    lemmaDebug("client", "trace sent", {
      traceId: payload.trace.id,
      projectId: payload.project_id,
      status: response.status,
      ...responseHeaders,
      ...(sentWarnings.length ? { warnings: sentWarnings } : {}),
    });

    if (isDebugModeEnabled() && isDebugVerifyEnabled() && payload.trace.id) {
      await this.verifyIngestDelivery(payload.trace.id);
    }
  }
}
