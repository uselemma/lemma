import { randomUUID } from "node:crypto";

import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";

import {
  Lemma,
  TraceContext,
  type LemmaClientOptions,
  type SpanOptions as LemmaSpanOptions,
} from "@uselemma/tracing";

import {
  requireCredentials,
  type CredentialOptions,
  type LemmaPiCredentials,
} from "./credentials.js";
import { sanitizeRecord } from "./sanitize.js";

type TelemetryEvent = {
  name: string;
  attributes: Record<string, unknown>;
};

type TelemetryNode = {
  id: string;
  parentId?: string;
  name: string;
  attributes: Record<string, unknown>;
  events: TelemetryEvent[];
  status: SpanStatus;
  startedAt: Date;
  endedAt?: Date;
  children: TelemetryNode[];
};

export type LemmaPiTelemetryOptions = CredentialOptions & {
  credentials?: LemmaPiCredentials;
  fetch?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
  onDeliveryError?: (message: string) => void;
};

const HARNESS_ATTRIBUTES = {
  "lemma.harness.id": "pi",
  "lemma.sdk.integration": "coding-agent",
  "lemma.harness.session_event_source": "telemetry-interface",
} as const;

function optionalString(
  attributes: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(
  attributes: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = attributes[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function errorMessage(status: SpanStatus): string | undefined {
  return status.status === "error"
    ? (status.error?.message ??
        status.error?.name ??
        "Pi telemetry span failed")
    : undefined;
}

function metadata(node: TelemetryNode): Record<string, unknown> {
  return {
    ...HARNESS_ATTRIBUTES,
    "pi.telemetry.span_name": node.name,
    ...(node.events.length > 0 ? { "pi.telemetry.events": node.events } : {}),
  };
}

function usage(attributes: Record<string, unknown>) {
  const inputTokens = optionalNumber(attributes, "pi.ai.usage.input_tokens");
  const outputTokens = optionalNumber(attributes, "pi.ai.usage.output_tokens");
  const cacheReadInputTokens = optionalNumber(
    attributes,
    "pi.ai.usage.cache_read_tokens",
  );
  const cacheCreationInputTokens = optionalNumber(
    attributes,
    "pi.ai.usage.cache_write_tokens",
  );
  const reasoningOutputTokens = optionalNumber(
    attributes,
    "pi.ai.usage.reasoning_tokens",
  );
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    reasoningOutputTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    reasoningOutputTokens,
  };
}

function commonSpanOptions(
  node: TelemetryNode,
  parentId: string | undefined,
): LemmaSpanOptions {
  return {
    id: node.id,
    parentId,
    name: node.name,
    input: node.attributes,
    output: node.status.status === "ok" ? node.attributes : undefined,
    error: errorMessage(node.status),
    status: node.status.status === "error" ? "ERROR" : "OK",
    startedAt: node.startedAt,
    endedAt: node.endedAt ?? null,
    attributes: { ...HARNESS_ATTRIBUTES, ...node.attributes },
    metadata: metadata(node),
  };
}

function recordNode(
  trace: TraceContext,
  node: TelemetryNode,
  parentId: string | undefined,
): void {
  const options = commonSpanOptions(node, parentId);
  if (node.name === "pi.ai.request") {
    trace.recordGeneration({
      ...options,
      name: "pi model request",
      model:
        optionalString(node.attributes, "pi.ai.response.model") ??
        optionalString(node.attributes, "pi.ai.model"),
      llmProvider: optionalString(node.attributes, "pi.ai.provider"),
      usage: usage(node.attributes),
    });
  } else if (node.name === "pi.harness.tool") {
    const toolName = optionalString(node.attributes, "pi.tool.name") ?? "tool";
    trace.recordTool({ ...options, name: toolName, toolName });
  } else {
    trace.recordSpan(options);
  }
  for (const child of node.children) recordNode(trace, child, node.id);
}

function traceForRoot(root: TelemetryNode): TraceContext {
  const sessionId = optionalString(root.attributes, "pi.session.id");
  const operationId = optionalString(root.attributes, "pi.operation.id");
  const trace = new TraceContext({
    name: "pi coding agent",
    input: operationId ? { operationId } : root.attributes,
    output: root.attributes,
    threadId: sessionId,
    metadata: {
      ...HARNESS_ATTRIBUTES,
      ...(sessionId ? { "lemma.harness.session_id": sessionId } : {}),
      ...(operationId ? { "lemma.harness.turn_id": operationId } : {}),
      "pi.telemetry.root_span": root.name,
    },
  });
  if (root.name === "pi.harness.run") {
    for (const child of root.children) recordNode(trace, child, undefined);
  } else {
    recordNode(trace, root, undefined);
  }
  if (root.status.status === "error") trace.fail(errorMessage(root.status));
  return trace;
}

class LemmaTelemetrySpan implements TelemetrySpan {
  constructor(
    private readonly context: LemmaTelemetryContext,
    private readonly node: TelemetryNode,
  ) {}

  startSpan<T>(
    options: SpanOptions,
    callback: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    return this.context.startChild(this.node, options, callback);
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    this.node.events.push({
      name,
      attributes: sanitizeRecord(attributes as Record<string, unknown>),
    });
  }

  setAttributes(attributes: SpanAttributes): void {
    Object.assign(
      this.node.attributes,
      sanitizeRecord(attributes as Record<string, unknown>),
    );
  }

  setStatus(status: SpanStatus): void {
    this.node.status = status;
  }
}

class LemmaTelemetryContext implements TelemetryContext {
  private readonly client: Lemma;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly onDeliveryError: (message: string) => void;

  constructor(
    credentials: LemmaPiCredentials,
    options: LemmaPiTelemetryOptions,
  ) {
    const clientOptions: LemmaClientOptions = {
      apiKey: credentials.accessToken,
      projectId: credentials.projectId,
      baseUrl: credentials.apiUrl,
      fetch: options.fetch,
    };
    this.client = new Lemma(clientOptions);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.onDeliveryError =
      options.onDeliveryError ??
      (() => {
        console.warn(
          "Lemma Pi trace delivery failed. Run `pnpm dlx @uselemma/pi setup` to reconnect or rotate the scoped credential.",
        );
      });
  }

  startSpan<T>(
    options: SpanOptions,
    callback: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    return this.startChild(undefined, options, callback);
  }

  async startChild<T>(
    parent: TelemetryNode | undefined,
    options: SpanOptions,
    callback: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    const node: TelemetryNode = {
      id: this.createId(),
      parentId: parent?.id,
      name: options.name,
      attributes: sanitizeRecord(
        (options.attributes ?? {}) as Record<string, unknown>,
      ),
      events: [],
      status: { status: "ok" },
      startedAt: this.now(),
      children: [],
    };
    parent?.children.push(node);
    const span = new LemmaTelemetrySpan(this, node);
    try {
      return await callback(span);
    } catch (error) {
      if (node.status.status !== "error") {
        node.status = {
          status: "error",
          error: {
            name: error instanceof Error ? error.name : "Error",
            message:
              error instanceof Error ? error.message : "Pi operation failed",
          },
        };
      }
      throw error;
    } finally {
      node.endedAt = this.now();
      if (!parent) {
        try {
          await this.client.ingest(traceForRoot(node), {
            startedAt: node.startedAt,
            endedAt: node.endedAt,
          });
        } catch {
          this.onDeliveryError(
            "Lemma Pi trace delivery failed. Reconnect or rotate the scoped credential.",
          );
        }
      }
    }
  }
}

export function createLemmaPiTelemetryContext(
  options: LemmaPiTelemetryOptions = {},
): TelemetryContext {
  return new LemmaTelemetryContext(requireCredentials(options), options);
}
