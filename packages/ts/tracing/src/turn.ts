import {
  Lemma,
  SpanHandle,
  TraceContext,
  TraceHandle,
  type GenerationOptions,
  type SpanOptions,
  type SpanType,
  type TokenUsage,
  type ToolOptions,
  type TraceEndOptions,
  type TraceOptions,
} from "./client";

export const TURN_CONTEXT_VERSION = 1 as const;
export const TURN_JOURNAL_VERSION = 1 as const;

export type TurnContextToken = {
  version: typeof TURN_CONTEXT_VERSION;
  traceId: string;
  parentSpanId?: string | null;
  threadId?: string;
  userId?: string;
  startedAt: string;
  name?: string;
};

export type TurnJournalSpan = {
  id: string;
  parentId?: string | null;
  name?: string;
  type?: SpanType;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number;
  status?: "OK" | "ERROR";
  error?: unknown;
  model?: string;
  toolName?: string;
  usage?: TokenUsage;
  userFacingMessage?: string;
  llmProvider?: string;
  llmModelName?: string;
  llmInputMessages?: unknown[];
  llmOutputMessages?: unknown[];
  llmInvocationParameters?: unknown;
  llmTools?: unknown;
};

export type TurnJournalRecord = TurnJournalSpan & {
  op: "start" | "end" | "record";
};

export type TurnJournal = {
  version: typeof TURN_JOURNAL_VERSION;
  token: TurnContextToken;
  records: TurnJournalRecord[];
};

export type TurnJournalInput =
  | TurnJournal
  | TurnJournalRecord
  | TurnJournalRecord[]
  | string;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function isoNow(): string {
  return new Date().toISOString();
}

function asIso(value: Date | string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return value instanceof Date ? value.toISOString() : value;
}

export function parseTurnContextToken(
  value: string | TurnContextToken,
): TurnContextToken {
  const token =
    typeof value === "string"
      ? (JSON.parse(value) as TurnContextToken)
      : value;
  if (
    !token ||
    typeof token !== "object" ||
    token.version !== TURN_CONTEXT_VERSION ||
    typeof token.traceId !== "string" ||
    token.traceId.length === 0 ||
    typeof token.startedAt !== "string" ||
    token.startedAt.length === 0
  ) {
    throw new Error("@uselemma/tracing: invalid turn context token");
  }
  return token;
}

function parseJournal(input: TurnJournalInput): {
  token?: TurnContextToken;
  records: TurnJournalRecord[];
} {
  const value =
    typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (Array.isArray(value)) {
    return { records: value };
  }
  if (value && typeof value === "object" && "op" in value) {
    return { records: [value as TurnJournalRecord] };
  }
  if (
    value &&
    typeof value === "object" &&
    "records" in value &&
    Array.isArray((value as TurnJournal).records)
  ) {
    const journal = value as TurnJournal;
    if (
      journal.version !== undefined &&
      journal.version !== TURN_JOURNAL_VERSION
    ) {
      throw new Error(
        `@uselemma/tracing: unsupported turn journal version ${String(journal.version)}`,
      );
    }
    return { token: journal.token, records: journal.records };
  }
  throw new Error("@uselemma/tracing: invalid turn journal");
}

function toSpanOptions(
  record: TurnJournalRecord,
  fallbackParentId?: string | null,
): SpanOptions {
  return compact({
    id: record.id,
    parentId: record.parentId ?? fallbackParentId,
    name: record.name ?? "span",
    type: record.type,
    input: record.input,
    output: record.output,
    metadata: record.metadata,
    attributes: record.attributes,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    status: record.status,
    error: record.error,
    model: record.model,
    toolName: record.toolName,
    usage: record.usage,
    userFacingMessage: record.userFacingMessage,
    llmProvider: record.llmProvider,
    llmModelName: record.llmModelName,
    llmInputMessages: record.llmInputMessages,
    llmOutputMessages: record.llmOutputMessages,
    llmInvocationParameters: record.llmInvocationParameters,
    llmTools: record.llmTools,
  });
}

function startFromRecord(
  context: TraceContext,
  options: SpanOptions,
): SpanHandle {
  const type = options.type ?? "span";
  if (type === "generation") {
    return context.startGeneration(options);
  }
  if (type === "tool") {
    return context.startTool(options);
  }
  return context.startSpan(options);
}

function recordFromRecord(context: TraceContext, options: SpanOptions) {
  const type = options.type ?? "span";
  if (type === "generation") {
    context.recordGeneration(options);
    return;
  }
  if (type === "tool") {
    context.recordTool(options);
    return;
  }
  context.recordSpan(options);
}

/**
 * Hydrate a coordinator {@link TraceContext} from a child-process journal.
 * Re-applying the same records is a no-op for already-present span ids.
 */
export function applyTurnJournal(
  context: TraceContext,
  input: TurnJournalInput,
): void {
  const { token, records } = parseJournal(input);
  const fallbackParentId = token?.parentSpanId ?? null;
  for (const record of records) {
    if (!record?.id || !record.op) continue;
    const options = toSpanOptions(record, fallbackParentId);
    if (record.op === "start") {
      if (context.hasSpan(record.id)) continue;
      startFromRecord(context, { ...options, endedAt: undefined });
      continue;
    }
    if (record.op === "end") {
      const handle = context.spanHandle(record.id);
      if (handle) {
        const endOptions: Omit<SpanOptions, "id" | "name" | "type" | "startedAt"> & {
          userFacingMessage?: string;
        } = {
          output: record.output,
          metadata: record.metadata,
          attributes: record.attributes,
          endedAt: record.endedAt ?? undefined,
          durationMs: record.durationMs,
          status: record.status,
          error: record.error,
          model: record.model,
          toolName: record.toolName,
          usage: record.usage,
          userFacingMessage: record.userFacingMessage,
          llmProvider: record.llmProvider,
          llmModelName: record.llmModelName,
          llmOutputMessages: record.llmOutputMessages,
          llmInvocationParameters: record.llmInvocationParameters,
          llmTools: record.llmTools,
        };
        handle.end(endOptions);
        continue;
      }
      if (context.hasSpan(record.id)) continue;
      recordFromRecord(context, options);
      continue;
    }
    if (context.hasSpan(record.id)) continue;
    recordFromRecord(context, options);
  }
}

/**
 * Build a {@link TraceContext} from a context token and optional journal,
 * ready for a single strict {@link Lemma.ingest} call.
 */
export function assembleTurn(
  token: string | TurnContextToken,
  journal?: TurnJournalInput,
  options: Omit<TraceOptions, "id"> = {},
): { context: TraceContext; startedAt: Date } {
  const parsed = parseTurnContextToken(token);
  const context = new TraceContext({
    id: parsed.traceId,
    name: options.name ?? parsed.name ?? "trace",
    input: options.input,
    output: options.output,
    metadata: options.metadata,
    threadId: options.threadId ?? parsed.threadId,
    userId: options.userId ?? parsed.userId,
    durationMs: options.durationMs,
    startedAt: options.startedAt ?? parsed.startedAt,
  });
  if (journal !== undefined) applyTurnJournal(context, journal);
  return { context, startedAt: new Date(parsed.startedAt) };
}

function spanFields(
  options: SpanOptions & ToolOptions & { type?: SpanType },
  fallbackParentId?: string | null,
): TurnJournalSpan {
  const toolOptions = options as ToolOptions;
  return compact({
    id: options.id ?? crypto.randomUUID(),
    parentId:
      options.parentId ?? options.parentSpanId ?? fallbackParentId ?? null,
    name: options.name,
    type: options.type,
    input: options.input,
    output: options.output,
    metadata: options.metadata,
    attributes: options.attributes,
    startedAt: asIso(options.startedAt),
    endedAt: asIso(options.endedAt),
    durationMs: options.durationMs,
    status: options.status,
    error: options.error,
    model: options.model,
    toolName: toolOptions.toolName,
    usage: options.usage,
    userFacingMessage: toolOptions.userFacingMessage,
    llmProvider: options.llmProvider,
    llmModelName: options.llmModelName,
    llmInputMessages: options.llmInputMessages,
    llmOutputMessages: options.llmOutputMessages,
    llmInvocationParameters: options.llmInvocationParameters,
    llmTools: options.llmTools,
  });
}

export class AttachedSpanHandle {
  readonly id: string;

  constructor(
    private readonly recorder: AttachedTurn,
    private readonly fields: TurnJournalSpan,
    private ended = false,
  ) {
    this.id = fields.id;
  }

  end(
    options: Omit<SpanOptions, "id" | "name" | "type" | "startedAt"> = {},
  ) {
    if (this.ended) return;
    this.ended = true;
    this.recorder.append({
      op: "end",
      ...spanFields(
        {
          ...this.fields,
          ...options,
          id: this.id,
          name: this.fields.name ?? "span",
        },
        this.fields.parentId,
      ),
      id: this.id,
      startedAt: this.fields.startedAt,
    });
  }

  startSpan(name: string): AttachedSpanHandle;
  startSpan(options: Omit<SpanOptions, "endedAt">): AttachedSpanHandle;
  startSpan(
    options: string | Omit<SpanOptions, "endedAt">,
  ): AttachedSpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.recorder.startSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id,
    });
  }

  startGeneration(name: string): AttachedSpanHandle;
  startGeneration(
    options: Omit<GenerationOptions, "endedAt" | "type">,
  ): AttachedSpanHandle;
  startGeneration(
    options: string | Omit<GenerationOptions, "endedAt" | "type">,
  ): AttachedSpanHandle {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    return this.recorder.startGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id,
    });
  }

  startTool(name: string): AttachedSpanHandle;
  startTool(options: Omit<ToolOptions, "endedAt" | "type">): AttachedSpanHandle;
  startTool(
    options: string | Omit<ToolOptions, "endedAt" | "type">,
  ): AttachedSpanHandle {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    return this.recorder.startTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id,
    });
  }

  recordSpan(name: string): AttachedSpanHandle;
  recordSpan(options: SpanOptions): AttachedSpanHandle;
  recordSpan(options: string | SpanOptions): AttachedSpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.recorder.recordSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id,
    });
  }

  recordGeneration(options: string | GenerationOptions) {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    this.recorder.recordGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id,
    });
  }

  recordTool(options: string | ToolOptions) {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    this.recorder.recordTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id,
    });
  }
}

/** Local recorder for a worker/sandbox process. Never calls Lemma. */
export class AttachedTurn {
  readonly token: TurnContextToken;
  private readonly journal: TurnJournalRecord[] = [];

  constructor(token: string | TurnContextToken) {
    this.token = parseTurnContextToken(token);
  }

  get id() {
    return this.token.traceId;
  }

  append(record: TurnJournalRecord) {
    this.journal.push(record);
  }

  records(): TurnJournal {
    return {
      version: TURN_JOURNAL_VERSION,
      token: this.token,
      records: this.journal,
    };
  }

  startSpan(name: string): AttachedSpanHandle;
  startSpan(options: Omit<SpanOptions, "endedAt">): AttachedSpanHandle;
  startSpan(
    options: string | Omit<SpanOptions, "endedAt">,
  ): AttachedSpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.start("span", spanOptions);
  }

  startGeneration(name: string): AttachedSpanHandle;
  startGeneration(
    options: Omit<GenerationOptions, "endedAt" | "type">,
  ): AttachedSpanHandle;
  startGeneration(
    options: string | Omit<GenerationOptions, "endedAt" | "type">,
  ): AttachedSpanHandle {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    return this.start("generation", generationOptions);
  }

  startTool(name: string): AttachedSpanHandle;
  startTool(options: Omit<ToolOptions, "endedAt" | "type">): AttachedSpanHandle;
  startTool(
    options: string | Omit<ToolOptions, "endedAt" | "type">,
  ): AttachedSpanHandle {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    return this.start("tool", toolOptions);
  }

  recordSpan(name: string): AttachedSpanHandle;
  recordSpan(options: SpanOptions): AttachedSpanHandle;
  recordSpan(options: string | SpanOptions): AttachedSpanHandle {
    const spanOptions =
      typeof options === "string" ? { name: options } : options;
    return this.record("span", spanOptions);
  }

  recordGeneration(options: string | GenerationOptions) {
    const generationOptions =
      typeof options === "string" ? { name: options } : options;
    this.record("generation", generationOptions);
  }

  recordTool(options: string | ToolOptions) {
    const toolOptions =
      typeof options === "string" ? { name: options } : options;
    this.record("tool", toolOptions);
  }

  private start(
    type: SpanType,
    options: Omit<SpanOptions, "endedAt">,
  ): AttachedSpanHandle {
    const fields = spanFields(
      {
        ...options,
        type,
        id: options.id ?? crypto.randomUUID(),
        startedAt: options.startedAt ?? isoNow(),
      },
      this.token.parentSpanId,
    );
    this.append({ op: "start", ...fields, type });
    return new AttachedSpanHandle(this, { ...fields, type });
  }

  private record(
    type: SpanType,
    options: SpanOptions,
  ): AttachedSpanHandle {
    const now = isoNow();
    const fields = spanFields(
      {
        ...options,
        type,
        id: options.id ?? crypto.randomUUID(),
        startedAt: options.startedAt ?? now,
        endedAt: options.endedAt === undefined ? now : options.endedAt,
      },
      this.token.parentSpanId,
    );
    this.append({ op: "record", ...fields, type });
    return new AttachedSpanHandle(this, { ...fields, type }, true);
  }
}

export class TurnHandle extends TraceHandle {
  export(options: { parentSpanId?: string | null } = {}): TurnContextToken {
    const identity = this.identity();
    return compact({
      version: TURN_CONTEXT_VERSION,
      traceId: this.id,
      parentSpanId: options.parentSpanId ?? null,
      threadId: identity.threadId,
      userId: identity.userId,
      startedAt: this.startedAt.toISOString(),
      name: identity.name,
    });
  }

  apply(input: TurnJournalInput) {
    applyTurnJournal(this, input);
  }
}

export function startTurn(
  lemma: Lemma,
  options: TraceOptions = {},
): TurnHandle {
  return new TurnHandle(
    options,
    async (trace, startedAt, endedAt) => {
      await lemma.ingest(trace, { startedAt, endedAt });
    },
  );
}

export function attachTurn(
  token: string | TurnContextToken,
): AttachedTurn {
  return new AttachedTurn(token);
}
