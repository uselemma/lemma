import {
  Lemma,
  type LemmaClientOptions,
  type SpanOptions,
  type TraceHandle,
} from "./client";
import { toolResultError } from "./tool-result";

/** Mastra AI-tracing span type strings (structural; no @mastra/* dependency). */
export type MastraSpanType =
  | "agent_run"
  | "workflow_run"
  | "model_generation"
  | "model_step"
  | "model_chunk"
  | "tool_call"
  | "mcp_tool_call"
  | "client_tool_call"
  | "provider_tool_call"
  | "processor_run"
  | "workflow_step"
  | "workflow_conditional"
  | "workflow_conditional_eval"
  | "workflow_parallel"
  | "workflow_loop"
  | "workflow_sleep"
  | "workflow_wait_event"
  | "generic"
  | (string & {});

export type MastraErrorInfo = {
  message: string;
  id?: string;
  domain?: string;
  category?: string;
  details?: Record<string, unknown>;
};

export type MastraExportedSpan = {
  id: string;
  traceId: string;
  name: string;
  type: MastraSpanType;
  parentSpanId?: string;
  isRootSpan: boolean;
  isEvent: boolean;
  /** Mastra entity id (e.g. tool id on tool spans). */
  entityId?: string;
  /** Mastra entity name (e.g. tool name on tool spans). */
  entityName?: string;
  startTime: Date | string;
  endTime?: Date | string;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  errorInfo?: MastraErrorInfo;
  requestContext?: Record<string, unknown>;
  tags?: string[];
};

export type MastraTracingEvent =
  | { type: "span_started"; exportedSpan: MastraExportedSpan }
  | { type: "span_updated"; exportedSpan: MastraExportedSpan }
  | { type: "span_ended"; exportedSpan: MastraExportedSpan };

export type MastraIntegrationOptions = {
  lemma?: Lemma;
  apiKey?: LemmaClientOptions["apiKey"];
  projectId?: LemmaClientOptions["projectId"];
  baseUrl?: LemmaClientOptions["baseUrl"];
  fetch?: LemmaClientOptions["fetch"];
  agentName?: string;
  generationName?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  /** Key looked up on root metadata / requestContext for threadId. Default: `threadId`. */
  threadIdKey?: string;
  /** Key looked up on root metadata / requestContext for userId. Default: `userId`, then `resourceId`. */
  userIdKey?: string;
};

export type LemmaMastraIntegrationOptions = MastraIntegrationOptions;

type BufferedTrace = {
  children: MastraExportedSpan[];
  childIds: Set<string>;
};

const GENERATION_TYPES = new Set(["model_generation", "model_step"]);
const TOOL_TYPES = new Set([
  "tool_call",
  "mcp_tool_call",
  "client_tool_call",
  "provider_tool_call",
]);

function toDate(value: Date | string | undefined): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function durationMs(
  start: Date | string | undefined,
  end: Date | string | undefined,
): number | undefined {
  const startedAt = toDate(start);
  const endedAt = toDate(end);
  if (!startedAt || !endedAt) return undefined;
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
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

function attributeString(
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = attributes?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function asOutputMessages(output: unknown): unknown[] | undefined {
  if (output == null) return undefined;
  if (Array.isArray(output)) return output;
  if (typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.role === "string") return [output];
    // Mastra model_generation often ends with `{ text, ... }` (no role).
    if (typeof record.text === "string") {
      return [{ role: "assistant", content: record.text }];
    }
  }
  return [{ role: "assistant", content: output }];
}

/** Extract chat messages from a bare array or `{ messages: [...] }` Mastra input. */
function asInputMessages(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const messages = (input as Record<string, unknown>).messages;
    if (Array.isArray(messages)) return messages;
  }
  return undefined;
}

/** Parse `tool: 'name'` / `tool: "name"` style Mastra span names. */
function toolNameFromSpanName(name: string): string | undefined {
  const match = /^tool:\s*['"]([^'"]+)['"]\s*$/i.exec(name.trim());
  return match?.[1] || undefined;
}

function resolveToolName(span: MastraExportedSpan): string {
  if (typeof span.entityId === "string" && span.entityId) return span.entityId;
  if (typeof span.entityName === "string" && span.entityName) {
    return span.entityName;
  }
  return toolNameFromSpanName(span.name) ?? span.name;
}

function messageContent(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  const record = message as Record<string, unknown>;
  if ("content" in record) return record.content;
  return message;
}

/**
 * Prefer the current user turn for the Lemma root input.
 * Mastra agent_run roots usually set `input: { messages: [...] }`
 * (or occasionally a bare message array).
 */
function rootTraceInput(input: unknown): unknown {
  if (typeof input === "string") return input;

  const messages = asInputMessages(input);
  if (!messages || messages.length === 0) return input;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as Record<string, unknown>).role;
    if (role === "user") return messageContent(message);
  }

  return messageContent(messages[messages.length - 1]);
}

function resolveParentId(
  parentSpanId: string | undefined,
  rootSpanId: string | undefined,
  recordedIds: Set<string>,
): string | undefined {
  if (!parentSpanId || parentSpanId === rootSpanId) return undefined;
  if (!recordedIds.has(parentSpanId)) return undefined;
  return parentSpanId;
}

/** Prefer a human message from soft-failure payloads when success is false. */
function softFailureMessage(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }
  return undefined;
}

function childErrorMessage(span: MastraExportedSpan): string | undefined {
  if (span.errorInfo?.message) return span.errorInfo.message;
  if (!TOOL_TYPES.has(span.type)) return undefined;

  const fromOutput = toolResultError(span.output);
  if (fromOutput) return fromOutput;

  // Mastra validation / soft tool failures often set `attributes.success: false`
  // with an error-shaped output and no errorInfo.
  if (span.attributes?.success === false) {
    return softFailureMessage(span.output) ?? "Tool failed";
  }
  return undefined;
}

export class LemmaMastraExporter {
  name = "lemma";
  private lemma: Lemma | undefined;
  private readonly buffers = new Map<string, BufferedTrace>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: MastraIntegrationOptions = {}) {
    this.lemma = options.lemma;
  }

  private getLemma() {
    this.lemma ??= new Lemma({
      apiKey: this.options.apiKey,
      projectId: this.options.projectId,
      baseUrl: this.options.baseUrl,
      fetch: this.options.fetch,
    });
    return this.lemma;
  }

  private bufferFor(traceId: string): BufferedTrace {
    const existing = this.buffers.get(traceId);
    if (existing) return existing;
    const created: BufferedTrace = { children: [], childIds: new Set() };
    this.buffers.set(traceId, created);
    return created;
  }

  private pushChild(span: MastraExportedSpan) {
    const buffer = this.bufferFor(span.traceId);
    // Client-observability paths can emit both SPAN_STARTED and SPAN_ENDED for
    // the same event span; keep the latest payload for each id.
    if (buffer.childIds.has(span.id)) {
      const index = buffer.children.findIndex((child) => child.id === span.id);
      if (index >= 0) buffer.children[index] = span;
      return;
    }
    buffer.childIds.add(span.id);
    buffer.children.push(span);
  }

  private resolveThreadId(root: MastraExportedSpan): string | undefined {
    const key = this.options.threadIdKey ?? "threadId";
    return lookupString([root.metadata, root.requestContext], [key]);
  }

  private resolveUserId(root: MastraExportedSpan): string | undefined {
    if (this.options.userIdKey) {
      return lookupString(
        [root.metadata, root.requestContext],
        [this.options.userIdKey],
      );
    }
    return lookupString(
      [root.metadata, root.requestContext],
      ["userId", "resourceId"],
    );
  }

  private recordChild(
    trace: TraceHandle,
    span: MastraExportedSpan,
    parentId: string | undefined,
  ) {
    const startedAt = toDate(span.startTime) ?? new Date();
    const endedAt =
      toDate(span.endTime) ?? (span.isEvent ? startedAt : new Date());
    const errorMessage = childErrorMessage(span);
    const recordInputs = this.options.recordInputs !== false;
    const recordOutputs = this.options.recordOutputs !== false;
    const input = recordInputs ? span.input : undefined;
    const output =
      recordOutputs && !errorMessage ? span.output : undefined;
    const error = recordOutputs ? errorMessage : undefined;
    const status = errorMessage ? ("ERROR" as const) : undefined;
    const base: SpanOptions = {
      id: span.id,
      parentId,
      name: span.name,
      input,
      output,
      metadata: this.options.metadata,
      attributes: {
        "mastra.span_type": span.type,
        "mastra.trace_id": span.traceId,
        "mastra.span_id": span.id,
        ...(span.parentSpanId
          ? { "mastra.parent_span_id": span.parentSpanId }
          : {}),
      },
      startedAt,
      endedAt,
      durationMs: durationMs(startedAt, endedAt),
      status,
      error,
    };

    if (GENERATION_TYPES.has(span.type)) {
      const attrs = span.attributes;
      const llmInputMessages = recordInputs
        ? asInputMessages(span.input)
        : undefined;
      const llmOutputMessages =
        recordOutputs && !errorMessage
          ? asOutputMessages(span.output)
          : undefined;
      trace.recordGeneration({
        ...base,
        name: this.options.generationName ?? span.name,
        model: attributeString(attrs, "model"),
        llmProvider: attributeString(attrs, "provider"),
        llmInvocationParameters: attrs?.parameters,
        llmInputMessages,
        llmOutputMessages,
      });
      return;
    }

    if (TOOL_TYPES.has(span.type)) {
      const toolName = resolveToolName(span);
      trace.recordTool({
        ...base,
        name: this.options.toolName ?? span.name,
        toolName,
      });
      return;
    }

    trace.recordSpan(base);
  }

  private deliver(root: MastraExportedSpan, children: MastraExportedSpan[]) {
    const recordInputs = this.options.recordInputs !== false;
    const recordOutputs = this.options.recordOutputs !== false;
    const startedAt = toDate(root.startTime) ?? new Date();
    const endedAt = toDate(root.endTime) ?? new Date();
    const recordedIds = new Set(children.map((child) => child.id));

    const trace = this.getLemma().trace({
      id: root.traceId,
      name: this.options.agentName ?? root.name,
      input: recordInputs ? rootTraceInput(root.input) : undefined,
      metadata: {
        ...this.options.metadata,
        ...(root.metadata ?? {}),
        mastraTraceId: root.traceId,
        mastraSpanType: root.type,
        ...(root.tags?.length ? { mastraTags: root.tags } : {}),
      },
      threadId: this.resolveThreadId(root),
      userId: this.resolveUserId(root),
      durationMs: durationMs(startedAt, endedAt),
      startedAt,
    });

    for (const child of children) {
      this.recordChild(
        trace,
        child,
        resolveParentId(child.parentSpanId, root.id, recordedIds),
      );
    }

    if (root.errorInfo?.message) {
      trace.fail(root.errorInfo.message);
    }

    const endPromise = trace.end(
      recordOutputs && !root.errorInfo?.message
        ? {
            output: root.output,
            durationMs: durationMs(startedAt, endedAt),
            endedAt,
          }
        : { durationMs: durationMs(startedAt, endedAt), endedAt },
    );

    this.pending.add(endPromise);
    void endPromise.finally(() => this.pending.delete(endPromise));
    return endPromise;
  }

  async exportTracingEvent(event: MastraTracingEvent): Promise<void> {
    if (event.type === "span_updated") return;

    const span = event.exportedSpan;

    if (event.type === "span_started") {
      if (span.isEvent) {
        this.pushChild(span);
      }
      return;
    }

    // span_ended
    if (span.isRootSpan) {
      const buffer = this.buffers.get(span.traceId);
      const children = buffer?.children ?? [];
      this.buffers.delete(span.traceId);
      await this.deliver(span, children);
      return;
    }

    this.pushChild(span);
  }

  async flush(): Promise<void> {
    await Promise.all(Array.from(this.pending));
  }

  async shutdown(): Promise<void> {
    await this.flush();
    this.buffers.clear();
  }
}

export function mastra(
  options: MastraIntegrationOptions = {},
): LemmaMastraExporter {
  return new LemmaMastraExporter(options);
}
