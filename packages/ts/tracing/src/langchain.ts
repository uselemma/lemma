import {
  Lemma,
  type LemmaClientOptions,
  type SpanHandle,
  type TraceHandle,
} from "./client";
import { toolResultError } from "./tool-result";

type RunId = string;

type Serialized = {
  id?: string[];
  name?: string;
  kwargs?: Record<string, unknown>;
  lc?: number;
  [key: string]: unknown;
};

type LLMResult = {
  generations?: unknown[][];
  llmOutput?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LangChainIntegrationOptions = {
  lemma?: Lemma;
  apiKey?: LemmaClientOptions["apiKey"];
  projectId?: LemmaClientOptions["projectId"];
  baseUrl?: LemmaClientOptions["baseUrl"];
  fetch?: LemmaClientOptions["fetch"];
  agentName?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
  /** Key looked up on run metadata / tags for threadId. Default: `threadId`. */
  threadIdKey?: string;
  /** Key looked up on run metadata / tags for userId. Default: `userId`, then `resourceId`. */
  userIdKey?: string;
};

type RunKind = "chain" | "llm" | "tool" | "retriever";

type StoredRun = {
  owningTraceId: string;
  rootRunId: string;
  handle?: SpanHandle;
  kind: RunKind;
  startedAt: Date;
  parentRunId?: string;
  /** True when this run created and owns the managed trace. */
  ownsTrace: boolean;
  /**
   * Owned LLM ended with tool_calls — keep the run stub so later tools /
   * generations can nest, and defer finalize until a final answer or flush.
   */
  deferFinalize?: boolean;
};

type StoredTrace = {
  handle: TraceHandle;
  ended: boolean;
  rootInput?: unknown;
  rootOutput?: unknown;
  rootError?: string;
  earliestStart?: Date;
  latestEnd?: Date;
  openedAt: Date;
  hasRootInput: boolean;
};

const KNOWN_PROVIDERS = [
  "openai",
  "anthropic",
  "azure",
  "azure_openai",
  "google",
  "google_genai",
  "google_vertexai",
  "vertexai",
  "bedrock",
  "amazon_bedrock",
  "cohere",
  "mistral",
  "mistralai",
  "groq",
  "fireworks",
  "together",
  "ollama",
  "huggingface",
  "huggingface_hub",
  "deepseek",
  "xai",
  "perplexity",
] as const;

const CLASS_PROVIDER_HINTS: Array<[RegExp, string]> = [
  [/openai/i, "openai"],
  [/anthropic|claude/i, "anthropic"],
  [/azure/i, "azure"],
  [/vertex/i, "google"],
  [/google|gemini/i, "google"],
  [/bedrock|amazon/i, "bedrock"],
  [/cohere/i, "cohere"],
  [/mistral/i, "mistral"],
  [/groq/i, "groq"],
  [/fireworks/i, "fireworks"],
  [/together/i, "together"],
  [/ollama/i, "ollama"],
  [/hugging ?face|hf\b/i, "huggingface"],
  [/deepseek/i, "deepseek"],
  [/xai|grok/i, "xai"],
  [/perplexity/i, "perplexity"],
];

function serializedName(serialized: Serialized | undefined, fallback: string) {
  if (typeof serialized?.name === "string" && serialized.name) {
    return serialized.name;
  }
  const id = serialized?.id;
  if (Array.isArray(id) && id.length > 0) {
    return String(id[id.length - 1]);
  }
  return fallback;
}

function modelName(
  serialized: Serialized | undefined,
  extraParams?: Record<string, unknown>,
) {
  const kwargs = serialized?.kwargs;
  const sources = [kwargs, serialized, extraParams];
  for (const source of sources) {
    if (!source) continue;
    for (const key of [
      "model",
      "modelName",
      "model_name",
      "model_id",
      "modelId",
    ]) {
      const value = source[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return undefined;
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

function tagValue(tags: string[] | undefined, keys: string[]): string | undefined {
  if (!tags?.length) return undefined;
  for (const key of keys) {
    const prefix = `${key}:`;
    for (const tag of tags) {
      if (typeof tag !== "string") continue;
      if (tag.startsWith(prefix)) {
        const value = tag.slice(prefix.length).trim();
        if (value) return value;
      }
      if (tag.startsWith(`${key}=`)) {
        const value = tag.slice(key.length + 1).trim();
        if (value) return value;
      }
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

function messageRole(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as Record<string, unknown>;
  if (typeof record.role === "string" && record.role) return record.role;

  const type =
    (typeof record.type === "string" && record.type) ||
    (typeof record._type === "string" && record._type) ||
    (typeof (record as { getType?: () => string }).getType === "function"
      ? (record as { getType: () => string }).getType()
      : undefined);

  if (!type) {
    const id = record.id;
    if (Array.isArray(id) && id.length > 0) {
      return roleFromClassName(String(id[id.length - 1]));
    }
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.constructor === "function" &&
            typeof (record.constructor as { name?: string }).name === "string"
          ? (record.constructor as { name: string }).name
          : undefined;
    return name ? roleFromClassName(name) : undefined;
  }

  switch (type) {
    case "human":
    case "user":
      return "user";
    case "ai":
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    case "function":
      return "function";
    case "developer":
      return "developer";
    default:
      return roleFromClassName(type) ?? type;
  }
}

function roleFromClassName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.includes("human") || lower === "user") return "user";
  if (lower.includes("ai") || lower.includes("assistant")) return "assistant";
  if (lower.includes("system")) return "system";
  if (lower.includes("tool")) return "tool";
  if (lower.includes("function")) return "function";
  if (lower.includes("chat") && lower.includes("message")) return undefined;
  return undefined;
}

function toolCallsFromMessage(
  record: Record<string, unknown>,
): unknown[] | undefined {
  if (Array.isArray(record.tool_calls) && record.tool_calls.length) {
    return record.tool_calls;
  }
  if (Array.isArray(record.toolCalls) && record.toolCalls.length) {
    return record.toolCalls;
  }
  const additional = record.additional_kwargs;
  if (additional && typeof additional === "object") {
    const calls = (additional as Record<string, unknown>).tool_calls;
    if (Array.isArray(calls) && calls.length) return calls;
  }
  const kwargs = record.kwargs;
  if (kwargs && typeof kwargs === "object") {
    const calls = (kwargs as Record<string, unknown>).tool_calls;
    if (Array.isArray(calls) && calls.length) return calls;
  }
  return undefined;
}

/** Normalize LangChain message classes / dicts to `{ role, content, ... }`. */
function normalizeMessage(message: unknown): { role: string; content: unknown } {
  if (typeof message === "string") {
    return { role: "user", content: message };
  }
  if (!message || typeof message !== "object") {
    return { role: "user", content: message };
  }

  const record = message as Record<string, unknown>;
  // Serialized LangChain messages often nest fields under `kwargs`.
  const kwargs =
    record.kwargs && typeof record.kwargs === "object"
      ? (record.kwargs as Record<string, unknown>)
      : undefined;
  const content =
    "content" in record
      ? record.content
      : kwargs && "content" in kwargs
        ? kwargs.content
        : messageContent(message);
  const role = messageRole(message) ?? messageRole(kwargs) ?? "user";
  const normalized: { role: string; content: unknown; [key: string]: unknown } =
    {
      role,
      content,
    };

  const toolCalls = toolCallsFromMessage(record) ?? (kwargs ? toolCallsFromMessage(kwargs) : undefined);
  if (toolCalls) normalized.tool_calls = toolCalls;

  const toolCallId =
    (typeof record.tool_call_id === "string" && record.tool_call_id) ||
    (typeof record.toolCallId === "string" && record.toolCallId) ||
    (kwargs && typeof kwargs.tool_call_id === "string"
      ? kwargs.tool_call_id
      : undefined);
  if (toolCallId) normalized.tool_call_id = toolCallId;

  const name =
    (typeof record.name === "string" && record.name) ||
    (kwargs && typeof kwargs.name === "string" ? kwargs.name : undefined);
  if (name && (role === "tool" || role === "function")) {
    normalized.name = name;
  }

  return normalized;
}

function normalizeMessages(messages: unknown[]): Array<{
  role: string;
  content: unknown;
}> {
  return messages.map(normalizeMessage);
}

function asMessageList(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (Array.isArray(record.messages)) return record.messages;
    if (Array.isArray(record.input)) return record.input;
  }
  return undefined;
}

/** Prefer the current user turn for the Lemma root input. */
function rootTraceInput(input: unknown): unknown {
  if (typeof input === "string") return input;

  const messages = asMessageList(input);
  if (messages && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const normalized = normalizeMessage(messages[i]);
      if (normalized.role === "user") return normalized.content;
    }
    return normalizeMessage(messages[messages.length - 1]).content;
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of [
      "input",
      "question",
      "query",
      "prompt",
      "text",
      "user_input",
      "userInput",
    ]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
  }

  return input;
}

function rootTraceOutput(output: unknown): unknown {
  if (output == null) return output;
  if (typeof output === "string") return output;

  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    // Preserve structured assistant payloads (e.g. tool_calls) already normalized.
    if (
      record.role === "assistant" &&
      (record.tool_calls != null || record.toolCalls != null)
    ) {
      return output;
    }
  }

  const messages = asMessageList(output);
  if (messages && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const normalized = normalizeMessage(messages[i]);
      if (normalized.role === "assistant") {
        return structuredAssistantOutput(normalized);
      }
    }
    return structuredAssistantOutput(
      normalizeMessage(messages[messages.length - 1]),
    );
  }

  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    for (const key of ["output", "answer", "result", "text", "content"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
      if (value && typeof value === "object") {
        const nested = value as Record<string, unknown>;
        if (typeof nested.content === "string") return nested.content;
      }
    }
  }

  return output;
}

function structuredAssistantOutput(message: {
  role: string;
  content: unknown;
  tool_calls?: unknown;
}): unknown {
  if (message.tool_calls) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    };
  }
  return message.content;
}

function firstText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const message = record.message;
  if (message && typeof message === "object") {
    return firstText(message);
  }
  return undefined;
}

function generationMessage(item: unknown): unknown | undefined {
  if (!item || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (record.message != null) return record.message;
  // Prefer real chat messages; plain `{ text }` generation items are handled
  // via firstText so we don't re-wrap them as role/content objects incorrectly.
  if (
    typeof record.role === "string" ||
    typeof record.type === "string" ||
    typeof record._type === "string"
  ) {
    return record;
  }
  if ("content" in record && typeof record.text !== "string") return record;
  return undefined;
}

function llmStructuredOutput(result: LLMResult): unknown {
  const generations = result.generations;
  if (!Array.isArray(generations)) return result;

  const messages: Array<{ role: string; content: unknown }> = [];
  for (const group of generations) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const message = generationMessage(item);
      if (message != null) {
        messages.push(normalizeMessage(message));
        continue;
      }
      const text = firstText(item);
      if (text != null) {
        messages.push({ role: "assistant", content: text });
      }
    }
  }

  if (messages.length === 1) {
    return structuredAssistantOutput(messages[0] as {
      role: string;
      content: unknown;
      tool_calls?: unknown;
    });
  }
  if (messages.length > 1) return messages;

  const text = generations.flat().map(firstText).filter(Boolean).join("");
  return text || generations;
}

function llmOutputMessages(result: LLMResult): unknown[] | undefined {
  const generations = result.generations;
  if (!Array.isArray(generations)) return undefined;
  const messages: unknown[] = [];
  for (const group of generations) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const message = generationMessage(item);
      if (message != null) {
        messages.push(normalizeMessage(message));
        continue;
      }
      const text = firstText(item);
      if (text != null) messages.push({ role: "assistant", content: text });
    }
  }
  return messages.length ? messages : undefined;
}

function hasToolCalls(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  if (Array.isArray(output)) return output.some((item) => hasToolCalls(item));
  const record = output as Record<string, unknown>;
  if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
    return true;
  }
  if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) {
    return true;
  }
  return false;
}

function providerFromId(id: unknown): string | undefined {
  if (!Array.isArray(id)) return undefined;
  for (const part of id) {
    if (typeof part !== "string") continue;
    const lower = part.toLowerCase().replace(/-/g, "_");
    for (const provider of KNOWN_PROVIDERS) {
      if (lower === provider || lower.includes(provider)) {
        if (provider === "azure_openai") return "azure";
        if (provider === "google_genai" || provider === "google_vertexai") {
          return "google";
        }
        if (provider === "amazon_bedrock") return "bedrock";
        if (provider === "mistralai") return "mistral";
        if (provider === "huggingface_hub") return "huggingface";
        return provider;
      }
    }
    // langchain_openai / langchain_anthropic package ids
    const pkg = lower.match(/^langchain[_]?([a-z0-9]+)/);
    if (pkg?.[1] && pkg[1] !== "core" && pkg[1] !== "community") {
      return providerFromClassName(pkg[1]) ?? pkg[1];
    }
  }
  return undefined;
}

function providerFromClassName(name: string): string | undefined {
  for (const [pattern, provider] of CLASS_PROVIDER_HINTS) {
    if (pattern.test(name)) return provider;
  }
  return undefined;
}

function llmProvider(
  serialized: Serialized | undefined,
  extraParams?: Record<string, unknown>,
): string | undefined {
  const kwargs = serialized?.kwargs;
  const sources = [kwargs, serialized, extraParams];
  for (const source of sources) {
    if (!source) continue;
    for (const key of [
      "provider",
      "ls_provider",
      "llm_provider",
      "llmProvider",
    ]) {
      const value = source[key];
      if (typeof value === "string" && value && value !== "langchain") {
        return value;
      }
    }
  }

  const fromId = providerFromId(serialized?.id);
  if (fromId) return fromId;

  const className = serializedName(serialized, "");
  const fromClass = className ? providerFromClassName(className) : undefined;
  if (fromClass) return fromClass;

  const type =
    (typeof extraParams?._type === "string" && extraParams._type) ||
    (typeof kwargs?._type === "string" && (kwargs._type as string));
  if (type) {
    const fromType = providerFromClassName(type);
    if (fromType) return fromType;
  }

  return undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function durationMs(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime());
}

function langchainAttributes(
  runId: RunId,
  parentRunId: RunId | undefined,
  runType: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      "langchain.run_id": runId,
      "langchain.parent_run_id": parentRunId,
      "langchain.run_type": runType,
    }).filter(([, value]) => value !== undefined && value !== null),
  );
}

export class LemmaLangChainCallbackHandler {
  name = "lemma";
  private lemma: Lemma | undefined;
  private readonly runs = new Map<RunId, StoredRun>();
  private readonly traces = new Map<string, StoredTrace>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: LangChainIntegrationOptions = {}) {
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

  private recordInputs() {
    return this.options.recordInputs !== false;
  }

  private recordOutputs() {
    return this.options.recordOutputs !== false;
  }

  private resolveThreadId(
    metadata?: Record<string, unknown>,
    tags?: string[],
  ): string | undefined {
    const key = this.options.threadIdKey ?? "threadId";
    const keys = [key, "threadId", "thread_id", "conversation_id", "session_id"];
    return (
      lookupString([metadata, this.options.metadata], keys) ??
      tagValue(tags, keys)
    );
  }

  private resolveUserId(
    metadata?: Record<string, unknown>,
    tags?: string[],
  ): string | undefined {
    if (this.options.userIdKey) {
      return (
        lookupString(
          [metadata, this.options.metadata],
          [this.options.userIdKey],
        ) ?? tagValue(tags, [this.options.userIdKey])
      );
    }
    const keys = ["userId", "user_id", "resourceId"];
    return (
      lookupString([metadata, this.options.metadata], keys) ??
      tagValue(tags, keys)
    );
  }

  private applyIdentity(
    stored: StoredTrace,
    metadata?: Record<string, unknown>,
    tags?: string[],
  ) {
    const threadId = this.resolveThreadId(metadata, tags);
    const userId = this.resolveUserId(metadata, tags);
    if (threadId) stored.handle.threadId(threadId);
    if (userId) stored.handle.userId(userId);
  }

  private noteBounds(stored: StoredTrace, start?: Date, end?: Date) {
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

  private noteRootInput(stored: StoredTrace, input: unknown) {
    if (!this.recordInputs() || input == null || stored.hasRootInput) return;
    stored.rootInput = rootTraceInput(input);
    stored.hasRootInput = true;
    stored.handle.input(stored.rootInput);
  }

  private noteRootOutput(stored: StoredTrace, output: unknown) {
    if (!this.recordOutputs() || output == null || stored.rootError) return;
    stored.rootOutput = rootTraceOutput(output);
  }

  private noteRootError(stored: StoredTrace, error: string | undefined) {
    if (!error || stored.rootError) return;
    stored.rootError = error;
  }

  private trackPending(promise: Promise<void>) {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
  }

  private createOwnedTrace(
    runId: RunId,
    name: string,
    input: unknown,
    kind: RunKind,
    metadata?: Record<string, unknown>,
    tags?: string[],
  ): { stored: StoredTrace; run: StoredRun } {
    const startedAt = new Date();
    const handle = this.getLemma().trace({
      name,
      input: this.recordInputs() ? rootTraceInput(input) : undefined,
      metadata: {
        ...this.options.metadata,
        ...(metadata ?? {}),
        langchainRunId: runId,
      },
      threadId: this.resolveThreadId(metadata, tags),
      userId: this.resolveUserId(metadata, tags),
      startedAt,
    });
    const stored: StoredTrace = {
      handle,
      ended: false,
      openedAt: startedAt,
      earliestStart: startedAt,
      hasRootInput: this.recordInputs() && input != null,
      rootInput: this.recordInputs() ? rootTraceInput(input) : undefined,
    };
    this.traces.set(runId, stored);
    const run: StoredRun = {
      owningTraceId: runId,
      rootRunId: runId,
      kind,
      startedAt,
      ownsTrace: true,
    };
    this.runs.set(runId, run);
    return { stored, run };
  }

  private storedTrace(owningTraceId: string): StoredTrace | undefined {
    return this.traces.get(owningTraceId);
  }

  private parentRun(parentRunId: RunId | undefined): StoredRun | undefined {
    if (!parentRunId) return undefined;
    return this.runs.get(parentRunId);
  }

  /**
   * Resolve the parent attachment target.
   * - Known parent → attach under that parent's owning trace.
   * - Missing / unknown parent → create a NEW owned trace for this run
   *   (never overwrite another concurrent trace's state).
   */
  private resolveAttachment(
    runId: RunId,
    parentRunId: RunId | undefined,
    createRoot: () => { stored: StoredTrace; run: StoredRun },
  ): {
    stored: StoredTrace;
    parentId: string | undefined;
    ownsTrace: boolean;
    owningTraceId: string;
    rootRunId: string;
  } {
    const parent = this.parentRun(parentRunId);
    if (!parent) {
      const created = createRoot();
      return {
        stored: created.stored,
        parentId: undefined,
        ownsTrace: true,
        owningTraceId: runId,
        rootRunId: runId,
      };
    }

    const stored = this.storedTrace(parent.owningTraceId);
    if (!stored || stored.ended) {
      // Parent bookkeeping is gone — start a fresh owned trace rather than
      // leaking into / stealing another concurrent run's state.
      const created = createRoot();
      return {
        stored: created.stored,
        parentId: undefined,
        ownsTrace: true,
        owningTraceId: runId,
        rootRunId: runId,
      };
    }

    // Orphan-safe: only nest under a still-open parent handle; otherwise attach
    // at the root of the same owned trace (parentId undefined).
    return {
      stored,
      parentId: parent.handle?.id,
      ownsTrace: false,
      owningTraceId: parent.owningTraceId,
      rootRunId: parent.rootRunId,
    };
  }

  private forgetTraceRuns(owningTraceId: string) {
    for (const [runId, run] of this.runs) {
      if (run.owningTraceId === owningTraceId) this.runs.delete(runId);
    }
  }

  private async finalizeTrace(owningTraceId: string, stored: StoredTrace) {
    this.traces.delete(owningTraceId);
    this.forgetTraceRuns(owningTraceId);
    if (stored.ended) return;
    stored.ended = true;

    const endedAt = stored.latestEnd ?? new Date();
    const startedAt = stored.earliestStart ?? stored.openedAt ?? endedAt;
    const timing = {
      startedAt,
      endedAt,
      durationMs: durationMs(startedAt, endedAt),
    };

    if (stored.rootError) {
      stored.handle.fail(
        this.recordOutputs() ? stored.rootError : "error",
      );
      const promise = stored.handle.end(timing);
      this.trackPending(promise);
      await promise;
      return;
    }

    if (!this.recordOutputs() || stored.rootOutput === undefined) {
      const promise = stored.handle.end(timing);
      this.trackPending(promise);
      await promise;
      return;
    }

    const promise = stored.handle.end({
      output: stored.rootOutput,
      ...timing,
    });
    this.trackPending(promise);
    await promise;
  }

  private maybeFinalizeOwner(run: StoredRun, endedAt: Date) {
    if (!run.ownsTrace) return;
    const stored = this.traces.get(run.owningTraceId);
    if (!stored) return;
    this.noteBounds(stored, run.startedAt, endedAt);
    const promise = this.finalizeTrace(run.owningTraceId, stored);
    this.trackPending(promise);
    return promise;
  }

  private traceName(serialized: Serialized | undefined, fallback: string) {
    return this.options.agentName ?? serializedName(serialized, fallback);
  }

  handleChainStart(
    serialized: Serialized,
    inputs: unknown,
    runId: RunId,
    parentRunId?: RunId,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    name?: string,
  ) {
    const startedAt = new Date();
    const chainName =
      name ?? serializedName(serialized, "langchain-chain");

    const parent = this.parentRun(parentRunId);
    if (!parent) {
      this.createOwnedTrace(
        runId,
        this.traceName(
          { ...serialized, name: name ?? serialized?.name },
          "langchain-run",
        ),
        inputs,
        "chain",
        metadata,
        tags,
      );
      return;
    }

    const stored = this.storedTrace(parent.owningTraceId);
    if (!stored || stored.ended) {
      this.createOwnedTrace(
        runId,
        this.traceName(
          { ...serialized, name: name ?? serialized?.name },
          "langchain-run",
        ),
        inputs,
        "chain",
        metadata,
        tags,
      );
      return;
    }

    this.applyIdentity(stored, metadata, tags);
    this.noteBounds(stored, startedAt, undefined);
    // Nested chains (incl. LangGraph nodes) become child spans; do not steal
    // root input from intermediate node state after the root already set it.
    const handle = stored.handle.startSpan({
      name: chainName,
      parentId: parent.handle?.id,
      input: this.recordInputs() ? inputs : undefined,
      metadata: this.options.metadata,
      attributes: langchainAttributes(
        runId,
        parentRunId,
        runType || "chain",
      ),
      startedAt,
    });
    this.runs.set(runId, {
      owningTraceId: parent.owningTraceId,
      rootRunId: parent.rootRunId,
      handle,
      kind: "chain",
      startedAt,
      parentRunId,
      ownsTrace: false,
    });
  }

  async handleChainEnd(outputs: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const stored = this.storedTrace(run.owningTraceId);

    if (run.handle) {
      run.handle.end({
        output: this.recordOutputs() ? outputs : undefined,
        endedAt,
        durationMs: durationMs(run.startedAt, endedAt),
      });
    }

    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) {
        this.noteRootOutput(stored, outputs);
      }
    }

    this.runs.delete(runId);
    if (run.ownsTrace && stored) {
      await this.finalizeTrace(run.owningTraceId, stored);
    }
  }

  async handleChainError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const message = errorMessage(error);
    const stored = this.storedTrace(run.owningTraceId);

    if (run.handle) {
      run.handle.end({
        status: "ERROR",
        error: this.recordOutputs() ? message : undefined,
        endedAt,
        durationMs: durationMs(run.startedAt, endedAt),
      });
    }

    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) {
        this.noteRootError(stored, message);
      }
    }

    this.runs.delete(runId);
    if (run.ownsTrace && stored) {
      await this.finalizeTrace(run.owningTraceId, stored);
    }
  }

  handleLLMStart(
    serialized: Serialized,
    prompts: string[],
    runId: RunId,
    parentRunId?: RunId,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const startedAt = new Date();
    const attachment = this.resolveAttachment(runId, parentRunId, () =>
      this.createOwnedTrace(
        runId,
        this.traceName(serialized, "langchain-llm"),
        prompts,
        "llm",
        metadata,
        tags,
      ),
    );

    // createOwnedTrace already registered the run when ownsTrace; update it.
    if (attachment.ownsTrace) {
      this.noteRootInput(attachment.stored, prompts);
    }
    this.applyIdentity(attachment.stored, metadata, tags);
    this.noteBounds(attachment.stored, startedAt, undefined);

    const provider = llmProvider(serialized, extraParams);
    const model = modelName(serialized, extraParams);
    const handle = attachment.stored.handle.startGeneration({
      name: serializedName(serialized, "langchain-llm"),
      parentId: attachment.parentId,
      input: this.recordInputs() ? prompts : undefined,
      metadata: this.options.metadata,
      model,
      llmProvider: provider,
      llmInputMessages: this.recordInputs()
        ? prompts.map((content) => ({ role: "user", content }))
        : undefined,
      llmInvocationParameters: extraParams,
      attributes: langchainAttributes(runId, parentRunId, "llm"),
      startedAt,
    });

    this.runs.set(runId, {
      owningTraceId: attachment.owningTraceId,
      rootRunId: attachment.rootRunId,
      handle,
      kind: "llm",
      startedAt,
      parentRunId,
      ownsTrace: attachment.ownsTrace,
    });
  }

  handleChatModelStart(
    serialized: Serialized,
    messages: unknown[][],
    runId: RunId,
    parentRunId?: RunId,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const startedAt = new Date();
    const flatMessages = messages.flat();
    const normalized = this.recordInputs()
      ? normalizeMessages(flatMessages)
      : undefined;

    const attachment = this.resolveAttachment(runId, parentRunId, () =>
      this.createOwnedTrace(
        runId,
        this.traceName(serialized, "langchain-chat-model"),
        flatMessages,
        "llm",
        metadata,
        tags,
      ),
    );

    if (attachment.ownsTrace) {
      this.noteRootInput(attachment.stored, flatMessages);
    }
    this.applyIdentity(attachment.stored, metadata, tags);
    this.noteBounds(attachment.stored, startedAt, undefined);

    const provider = llmProvider(serialized, extraParams);
    const model = modelName(serialized, extraParams);
    const handle = attachment.stored.handle.startGeneration({
      name: serializedName(serialized, "langchain-chat-model"),
      parentId: attachment.parentId,
      input: this.recordInputs() ? normalized : undefined,
      metadata: this.options.metadata,
      model,
      llmProvider: provider,
      llmInputMessages: normalized,
      llmInvocationParameters: extraParams,
      attributes: langchainAttributes(runId, parentRunId, "llm"),
      startedAt,
    });

    this.runs.set(runId, {
      owningTraceId: attachment.owningTraceId,
      rootRunId: attachment.rootRunId,
      handle,
      kind: "llm",
      startedAt,
      parentRunId,
      ownsTrace: attachment.ownsTrace,
    });
  }

  private deferredOwnerFor(owningTraceId: string): StoredRun | undefined {
    for (const run of this.runs.values()) {
      if (
        run.ownsTrace &&
        run.deferFinalize &&
        run.owningTraceId === owningTraceId
      ) {
        return run;
      }
    }
    return undefined;
  }

  async handleLLMEnd(output: LLMResult, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run?.handle) return;
    const endedAt = new Date();
    const structured = llmStructuredOutput(output);
    const outputMessages = llmOutputMessages(output);
    const softError = toolResultError(structured);
    const awaitingTools = !softError && hasToolCalls(structured);

    run.handle.end({
      output:
        this.recordOutputs() && !softError ? structured : undefined,
      error: this.recordOutputs() ? (softError ?? undefined) : undefined,
      status: softError ? "ERROR" : undefined,
      endedAt,
      durationMs: durationMs(run.startedAt, endedAt),
      llmOutputMessages:
        this.recordOutputs() && !softError ? outputMessages : undefined,
    });

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) {
        if (softError) this.noteRootError(stored, softError);
        else this.noteRootOutput(stored, structured);
      } else if (!softError) {
        // Prefer chain-level root output; refresh from later generations.
        this.noteRootOutput(stored, structured);
      }
    }

    if (run.ownsTrace && awaitingTools) {
      // Keep the run stub so tool/follow-up generation callbacks can nest
      // under this owned trace instead of opening a second root.
      run.deferFinalize = true;
      return;
    }

    this.runs.delete(runId);

    if (run.ownsTrace) {
      await this.maybeFinalizeOwner(run, endedAt);
      return;
    }

    // Final answer generation under a deferred owned LLM — close that root.
    if (!awaitingTools) {
      const deferred = this.deferredOwnerFor(run.owningTraceId);
      if (deferred) {
        this.runs.delete(deferred.rootRunId);
        await this.maybeFinalizeOwner(deferred, endedAt);
      }
    }
  }

  async handleLLMError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const message = errorMessage(error);

    run.handle?.end({
      status: "ERROR",
      error: this.recordOutputs() ? message : undefined,
      endedAt,
      durationMs: durationMs(run.startedAt, endedAt),
    });

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) this.noteRootError(stored, message);
    }

    this.runs.delete(runId);
    await this.maybeFinalizeOwner(run, endedAt);
  }

  handleToolStart(
    serialized: Serialized,
    input: unknown,
    runId: RunId,
    parentRunId?: RunId,
    tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const startedAt = new Date();
    const attachment = this.resolveAttachment(runId, parentRunId, () =>
      this.createOwnedTrace(
        runId,
        this.traceName(serialized, "langchain-tool"),
        input,
        "tool",
        metadata,
        tags,
      ),
    );

    if (attachment.ownsTrace) {
      this.noteRootInput(attachment.stored, input);
    }
    this.applyIdentity(attachment.stored, metadata, tags);
    this.noteBounds(attachment.stored, startedAt, undefined);

    const name = serializedName(serialized, "langchain-tool");
    const handle = attachment.stored.handle.startTool({
      name,
      parentId: attachment.parentId,
      toolName: name,
      input: this.recordInputs() ? input : undefined,
      metadata: this.options.metadata,
      attributes: langchainAttributes(runId, parentRunId, "tool"),
      startedAt,
    });

    this.runs.set(runId, {
      owningTraceId: attachment.owningTraceId,
      rootRunId: attachment.rootRunId,
      handle,
      kind: "tool",
      startedAt,
      parentRunId,
      ownsTrace: attachment.ownsTrace,
    });
  }

  async handleToolEnd(output: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const softError = toolResultError(output);

    if (softError) {
      run.handle?.end({
        status: "ERROR",
        error: this.recordOutputs() ? softError : undefined,
        endedAt,
        durationMs: durationMs(run.startedAt, endedAt),
      });
    } else {
      run.handle?.end({
        output: this.recordOutputs() ? output : undefined,
        endedAt,
        durationMs: durationMs(run.startedAt, endedAt),
      });
    }

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) {
        if (softError) this.noteRootError(stored, softError);
        else this.noteRootOutput(stored, output);
      }
    }

    this.runs.delete(runId);
    await this.maybeFinalizeOwner(run, endedAt);
  }

  async handleToolError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const message = errorMessage(error);

    run.handle?.end({
      status: "ERROR",
      error: this.recordOutputs() ? message : undefined,
      endedAt,
      durationMs: durationMs(run.startedAt, endedAt),
    });

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) this.noteRootError(stored, message);
    }

    this.runs.delete(runId);
    await this.maybeFinalizeOwner(run, endedAt);
  }

  handleRetrieverStart(
    serialized: Serialized,
    query: string,
    runId: RunId,
    parentRunId?: RunId,
    tags?: string[],
    metadata?: Record<string, unknown>,
  ) {
    const startedAt = new Date();
    const attachment = this.resolveAttachment(runId, parentRunId, () =>
      this.createOwnedTrace(
        runId,
        this.traceName(serialized, "langchain-retriever"),
        query,
        "retriever",
        metadata,
        tags,
      ),
    );

    if (attachment.ownsTrace) {
      this.noteRootInput(attachment.stored, query);
    }
    this.applyIdentity(attachment.stored, metadata, tags);
    this.noteBounds(attachment.stored, startedAt, undefined);

    const handle = attachment.stored.handle.startSpan({
      name: serializedName(serialized, "langchain-retriever"),
      parentId: attachment.parentId,
      input: this.recordInputs() ? query : undefined,
      metadata: this.options.metadata,
      attributes: langchainAttributes(runId, parentRunId, "retriever"),
      startedAt,
    });

    this.runs.set(runId, {
      owningTraceId: attachment.owningTraceId,
      rootRunId: attachment.rootRunId,
      handle,
      kind: "retriever",
      startedAt,
      parentRunId,
      ownsTrace: attachment.ownsTrace,
    });
  }

  async handleRetrieverEnd(documents: unknown[], runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();

    run.handle?.end({
      output: this.recordOutputs() ? documents : undefined,
      endedAt,
      durationMs: durationMs(run.startedAt, endedAt),
    });

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) this.noteRootOutput(stored, documents);
    }

    this.runs.delete(runId);
    await this.maybeFinalizeOwner(run, endedAt);
  }

  async handleRetrieverError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedAt = new Date();
    const message = errorMessage(error);

    run.handle?.end({
      status: "ERROR",
      error: this.recordOutputs() ? message : undefined,
      endedAt,
      durationMs: durationMs(run.startedAt, endedAt),
    });

    const stored = this.storedTrace(run.owningTraceId);
    if (stored) {
      this.noteBounds(stored, run.startedAt, endedAt);
      if (run.ownsTrace) this.noteRootError(stored, message);
    }

    this.runs.delete(runId);
    await this.maybeFinalizeOwner(run, endedAt);
  }

  /** Await outstanding terminal deliveries. */
  async flush(): Promise<void> {
    await Promise.all([
      ...Array.from(this.traces.entries(), ([id, stored]) =>
        this.finalizeTrace(id, stored),
      ),
      ...Array.from(this.pending),
    ]);
  }

  /** Finalize open traces and reset integration state. */
  async shutdown(): Promise<void> {
    await this.flush();
    this.runs.clear();
    this.traces.clear();
  }
}

export const LangChainCallbackHandler = LemmaLangChainCallbackHandler;

export function langChain(options: LangChainIntegrationOptions = {}) {
  return new LemmaLangChainCallbackHandler(options);
}

/**
 * LangGraph adapter: LangGraph emits LangChain callback events, so this is the
 * same handler with a LangGraph default trace name. Nesting, identity, and
 * finalization semantics match `langChain()`.
 */
export function langGraph(options: LangChainIntegrationOptions = {}) {
  return langChain({ agentName: "langgraph-agent", ...options });
}

export type LemmaLangChainIntegrationOptions = LangChainIntegrationOptions;
export type LemmaLangGraphIntegrationOptions = LangChainIntegrationOptions;
