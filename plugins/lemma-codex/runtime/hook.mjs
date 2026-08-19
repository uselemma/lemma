// src/hook-entry.ts
import { stdin, stderr, stdout } from "node:process";

// ../../packages/ts/tracing/src/debug-delivery.ts
var PRODUCTION_BASE_URL = "https://api.uselemma.ai";
var INGEST_PATH = "/traces/ingest";
var INGEST_STATUS_PATH = "/traces/ingest-status";
var EXPECTED_INGEST_SUCCESS_STATUS = 201;
var INGEST_STATUS_POLL_INTERVAL_MS = 1e3;
var INGEST_STATUS_POLL_TIMEOUT_MS = 15e3;
var SUCCESS_INGEST_STATUSES = /* @__PURE__ */ new Set([
  "enqueued",
  "ingested",
  "ready"
]);
function isSuccessfulIngestStatus(status) {
  return status != null && SUCCESS_INGEST_STATUSES.has(status);
}
function parseIngestStatus(value) {
  if (value === "enqueued" || value === "ingested" || value === "ready" || value === "not_found") {
    return value;
  }
  return null;
}
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidProjectId(projectId) {
  return UUID_REGEX.test(projectId);
}
function apiKeySuffix(apiKey) {
  if (apiKey.length <= 4) return apiKey;
  return `...${apiKey.slice(-4)}`;
}
function buildConfigWarnings(baseUrl, projectId) {
  const warnings = [];
  if (baseUrl !== PRODUCTION_BASE_URL) {
    warnings.push(`baseUrl is not production (${PRODUCTION_BASE_URL})`);
  }
  if (!isValidProjectId(projectId)) {
    warnings.push("projectId is not a valid UUID");
  }
  return warnings;
}
function ingestFailureHint(status) {
  switch (status) {
    case 401:
      return "check LEMMA_API_KEY";
    case 403:
      return "API key doesn't own this project_id";
    case 429:
      return "ingest rate limit exceeded; retry with backoff";
    case 404:
      return "baseUrl likely wrong (not Lemma API)";
    default:
      return void 0;
  }
}
function pickResponseHeaders(headers) {
  const picked = {};
  for (const name of ["cf-ray", "server", "date"]) {
    const value = headers.get(name);
    if (value) picked[name] = value;
  }
  return picked;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ../../packages/ts/tracing/src/debug-mode.ts
var debugModeEnabled = false;
function isEnvFlagEnabled(name) {
  const value = process.env[name];
  return value === "1" || value === "true";
}
function isDebugModeEnabled() {
  return debugModeEnabled || isEnvFlagEnabled("LEMMA_DEBUG");
}
function isDebugVerifyEnabled() {
  return isEnvFlagEnabled("LEMMA_DEBUG_VERIFY");
}
function lemmaDebug(prefix, msg, data) {
  if (!isDebugModeEnabled()) return;
  if (data !== void 0) {
    console.log(`[LEMMA:${prefix}] ${msg}`, data);
  } else {
    console.log(`[LEMMA:${prefix}] ${msg}`);
  }
}

// ../../packages/ts/tracing/src/error-message.ts
function errorMessage(error) {
  if (error == null) return null;
  if (error instanceof Error) {
    return qualify(errorClassName(error), error.message);
  }
  if (typeof error === "string") {
    return error.trim() || null;
  }
  if (typeof error === "object") {
    const record = error;
    if (typeof record.message === "string") {
      return qualify(
        typeof record.name === "string" ? record.name : void 0,
        record.message
      );
    }
    return stringifyObject(error);
  }
  return safeText(error) || null;
}
function describeError(error) {
  return errorMessage(error) ?? GENERIC_ERROR_NAME;
}
function failureMessage(error) {
  return error == null ? null : describeError(error);
}
function errorClassName(error) {
  const name = typeof error.name === "string" ? error.name : void 0;
  if (name && name !== GENERIC_ERROR_NAME) return name;
  const constructorName = error.constructor?.name;
  return (typeof constructorName === "string" ? constructorName : void 0) || name || GENERIC_ERROR_NAME;
}
function qualify(name, message) {
  const trimmedName = name?.trim();
  const trimmedMessage = messageText(message);
  if (!trimmedMessage) return trimmedName || GENERIC_ERROR_NAME;
  if (!trimmedName || trimmedName === GENERIC_ERROR_NAME || trimmedMessage.startsWith(`${trimmedName}:`)) {
    return trimmedMessage;
  }
  return `${trimmedName}: ${trimmedMessage}`;
}
function messageText(message) {
  if (typeof message === "string") return message.trim();
  if (message == null) return "";
  if (typeof message === "object") {
    const text = stringifyObject(message);
    return text === GENERIC_ERROR_NAME ? "" : text;
  }
  return safeText(message);
}
function stringifyObject(error) {
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
  }
  const text = safeText(error);
  return text && text !== "[object Object]" ? text : GENERIC_ERROR_NAME;
}
function safeText(value) {
  try {
    return String(value).trim();
  } catch {
    return "";
  }
}
var GENERIC_ERROR_NAME = "Error";

// ../../packages/ts/tracing/src/release.ts
var RELEASE_MAX_LENGTH = 200;
var CONTROL_CHARS = /[\n\t\r]/;
function normalizeRelease(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  if (trimmed.length === 0) return void 0;
  if (trimmed.length > RELEASE_MAX_LENGTH) return void 0;
  if (CONTROL_CHARS.test(trimmed)) return void 0;
  return trimmed;
}

// ../../packages/ts/tracing/src/usage.ts
function asFiniteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return value;
}
function pickNumber(source, keys) {
  for (const key of keys) {
    const value = asFiniteNumber(source[key]);
    if (value !== void 0) return value;
  }
  return void 0;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  return value;
}
function normalizeTokenUsage(raw) {
  if (raw == null) return void 0;
  let source = asRecord(raw);
  if (!source) return void 0;
  const nested = asRecord(source.tokenUsage) ?? asRecord(source.token_usage) ?? asRecord(source.usage_metadata) ?? asRecord(source.usage);
  if (nested) {
    const outerHasTokens = pickNumber(source, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens"
    ]) !== void 0;
    if (!outerHasTokens) source = nested;
  }
  const inputTokens = pickNumber(source, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens"
  ]);
  const outputTokens = pickNumber(source, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens"
  ]);
  const promptDetails = asRecord(source.prompt_tokens_details) ?? asRecord(source.promptTokensDetails) ?? asRecord(source.input_tokens_details) ?? asRecord(source.inputTokensDetails) ?? asRecord(source.input_token_details) ?? asRecord(source.inputTokenDetails);
  const completionDetails = asRecord(source.completion_tokens_details) ?? asRecord(source.completionTokensDetails) ?? asRecord(source.output_tokens_details) ?? asRecord(source.outputTokensDetails) ?? asRecord(source.output_token_details) ?? asRecord(source.outputTokenDetails);
  let cacheReadInputTokens = pickNumber(source, [
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedInputTokens",
    "cached_input_tokens",
    "cache_read"
  ]);
  if (cacheReadInputTokens === void 0 && promptDetails) {
    cacheReadInputTokens = pickNumber(promptDetails, [
      "cached_tokens",
      "cachedTokens",
      "cache_read",
      "cacheRead",
      // AI SDK 7 LanguageModelUsage.inputTokenDetails
      "cacheReadTokens",
      "cache_read_tokens"
    ]);
  }
  let cacheCreationInputTokens = pickNumber(source, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cache_creation",
    "cacheWriteTokens",
    "cache_write_tokens"
  ]);
  if (cacheCreationInputTokens === void 0 && promptDetails) {
    cacheCreationInputTokens = pickNumber(promptDetails, [
      "cache_creation",
      "cacheCreation",
      "cache_write",
      "cacheWrite",
      // OpenAI Responses / Agents + AI SDK 7
      "cache_write_tokens",
      "cacheWriteTokens"
    ]);
  }
  let reasoningOutputTokens = pickNumber(source, [
    "reasoningOutputTokens",
    "reasoning_output_tokens",
    "reasoningTokens",
    "reasoning_tokens"
  ]);
  if (reasoningOutputTokens === void 0 && completionDetails) {
    reasoningOutputTokens = pickNumber(completionDetails, [
      "reasoning_tokens",
      "reasoningTokens",
      "reasoning"
    ]);
  }
  const usage = {};
  if (inputTokens !== void 0) usage.inputTokens = inputTokens;
  if (outputTokens !== void 0) usage.outputTokens = outputTokens;
  if (cacheReadInputTokens !== void 0) {
    usage.cacheReadInputTokens = cacheReadInputTokens;
  }
  if (cacheCreationInputTokens !== void 0) {
    usage.cacheCreationInputTokens = cacheCreationInputTokens;
  }
  if (reasoningOutputTokens !== void 0) {
    usage.reasoningOutputTokens = reasoningOutputTokens;
  }
  if (Object.keys(usage).length === 0) return void 0;
  return usage;
}
function asUsageResult(raw) {
  return asRecord(raw);
}
function resultStepUsages(result) {
  if (Array.isArray(result.steps)) {
    return result.steps.map((step) => normalizeTokenUsage(step?.usage));
  }
  if (Array.isArray(result.rawResponses)) {
    return result.rawResponses.map(
      (response) => normalizeTokenUsage(response?.usage)
    );
  }
  return [];
}
function resultTotalUsage(result) {
  return normalizeTokenUsage(result.totalUsage) ?? normalizeTokenUsage(result.usage) ?? normalizeTokenUsage(result.usage_metadata) ?? normalizeTokenUsage(result.response_metadata) ?? normalizeTokenUsage(result);
}
function spanHasUsage(span) {
  return span.usage != null && Object.keys(span.usage).length > 0;
}
function stampSpanUsage(span, usage) {
  if (!usage || spanHasUsage(span)) return false;
  const wire = toWireTokenUsage(usage);
  if (!wire) return false;
  span.usage = wire;
  span.attributes = {
    ...span.attributes,
    ...tokenUsageAttributes(usage)
  };
  return true;
}
function attachResultUsage(generations, result) {
  if (generations.length === 0) return 0;
  const parsed = asUsageResult(result);
  if (!parsed) return 0;
  const steps = resultStepUsages(parsed);
  const total = resultTotalUsage(parsed);
  if (generations.length === 1) {
    return stampSpanUsage(generations[0], total ?? steps[0]) ? 1 : 0;
  }
  let stamped = 0;
  for (let i = 0; i < generations.length; i += 1) {
    if (stampSpanUsage(generations[i], steps[i])) stamped += 1;
  }
  if (stamped === 0 && total) {
    return stampSpanUsage(generations[0], total) ? 1 : 0;
  }
  return stamped;
}
function toWireTokenUsage(usage) {
  if (!usage) return void 0;
  const wire = {};
  if (usage.inputTokens !== void 0) wire.input_tokens = usage.inputTokens;
  if (usage.outputTokens !== void 0) wire.output_tokens = usage.outputTokens;
  if (usage.cacheReadInputTokens !== void 0) {
    wire.cache_read_input_tokens = usage.cacheReadInputTokens;
  }
  if (usage.cacheCreationInputTokens !== void 0) {
    wire.cache_creation_input_tokens = usage.cacheCreationInputTokens;
  }
  if (usage.reasoningOutputTokens !== void 0) {
    wire.reasoning_output_tokens = usage.reasoningOutputTokens;
  }
  return Object.keys(wire).length > 0 ? wire : void 0;
}
function tokenUsageAttributes(usage) {
  if (!usage) return {};
  const attributes = {};
  if (usage.inputTokens !== void 0) {
    attributes["gen_ai.usage.input_tokens"] = usage.inputTokens;
    attributes["llm.token_count.prompt"] = usage.inputTokens;
  }
  if (usage.outputTokens !== void 0) {
    attributes["gen_ai.usage.output_tokens"] = usage.outputTokens;
    attributes["llm.token_count.completion"] = usage.outputTokens;
  }
  if (usage.cacheReadInputTokens !== void 0) {
    attributes["gen_ai.usage.cache_read.input_tokens"] = usage.cacheReadInputTokens;
  }
  if (usage.cacheCreationInputTokens !== void 0) {
    attributes["gen_ai.usage.cache_creation.input_tokens"] = usage.cacheCreationInputTokens;
  }
  if (usage.reasoningOutputTokens !== void 0) {
    attributes["gen_ai.usage.reasoning.output_tokens"] = usage.reasoningOutputTokens;
  }
  return attributes;
}

// ../../packages/ts/tracing/src/client.ts
var SDK_LANGUAGE = "typescript";
var SDK_INTEGRATION_ATTR = "lemma.sdk.integration";
var SDK_LANGUAGE_ATTR = "lemma.sdk.language";
function required(value, envName) {
  if (value?.trim()) return value.trim();
  throw new Error(`@uselemma/tracing: Missing ${envName}`);
}
function iso(value) {
  if (value == null) return value;
  return value instanceof Date ? value.toISOString() : value;
}
function timestampMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function elapsedMs(start, end) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (startMs == null || endMs == null) return void 0;
  return Math.max(0, endMs - startMs);
}
function summarizeSpanForDebug(span, index) {
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
      hasInput: span.input !== void 0,
      hasOutput: span.output !== void 0,
      hasError: Boolean(span.error)
    }).filter(([, value]) => value !== void 0)
  );
}
function serializeAttribute(value) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function addDefined(attributes, key, value) {
  if (value !== void 0) attributes[key] = value;
}
function flattenMessage(attributes, prefix, message) {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    for (const [key, value] of Object.entries(
      message
    )) {
      addDefined(
        attributes,
        `${prefix}.message.${key}`,
        serializeAttribute(value)
      );
    }
    return;
  }
  addDefined(
    attributes,
    `${prefix}.message.content`,
    serializeAttribute(message)
  );
}
function flattenDocument(attributes, prefix, document) {
  if (document && typeof document === "object" && !Array.isArray(document)) {
    for (const [key, value] of Object.entries(
      document
    )) {
      addDefined(
        attributes,
        `${prefix}.document.${key}`,
        serializeAttribute(value)
      );
    }
    return;
  }
  addDefined(
    attributes,
    `${prefix}.document.content`,
    serializeAttribute(document)
  );
}
function resolveUsage(options) {
  return normalizeTokenUsage(options.usage);
}
function contractAttributes(options) {
  const attributes = {};
  addDefined(attributes, "input.mime_type", options.inputMimeType);
  addDefined(attributes, "output.mime_type", options.outputMimeType);
  addDefined(
    attributes,
    "llm.model_name",
    options.llmModelName ?? options.model
  );
  addDefined(attributes, "llm.provider", options.llmProvider);
  addDefined(attributes, "llm.system", options.llmSystem);
  addDefined(
    attributes,
    "gen_ai.system",
    options.llmSystem ?? options.llmProvider
  );
  Object.assign(attributes, tokenUsageAttributes(resolveUsage(options)));
  addDefined(
    attributes,
    "llm.invocation_parameters",
    serializeAttribute(options.llmInvocationParameters)
  );
  addDefined(attributes, "llm.tools", serializeAttribute(options.llmTools));
  addDefined(
    attributes,
    "llm.prompt_template.template",
    options.llmPromptTemplate
  );
  addDefined(
    attributes,
    "llm.prompt_template.variables",
    serializeAttribute(options.llmPromptTemplateVariables)
  );
  addDefined(
    attributes,
    "llm.prompt_template.version",
    options.llmPromptTemplateVersion
  );
  addDefined(attributes, "tool.description", options.toolDescription);
  addDefined(
    attributes,
    "tool.parameters",
    serializeAttribute(options.toolParameters)
  );
  if (options.userFacingMessage !== void 0) {
    attributes["lemma.tool.kind"] = "user_message";
    attributes["lemma.tool.message"] = options.userFacingMessage;
  }
  addDefined(attributes, "embedding.model_name", options.embeddingModelName);
  addDefined(
    attributes,
    "embedding.invocation_parameters",
    serializeAttribute(options.embeddingInvocationParameters)
  );
  addDefined(
    attributes,
    "embedding.embeddings",
    serializeAttribute(options.embeddingEmbeddings)
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
function spanAttributes(options) {
  const callerAttributes = options.attributes ?? {};
  const integration = typeof callerAttributes[SDK_INTEGRATION_ATTR] === "string" ? callerAttributes[SDK_INTEGRATION_ATTR] : "manual";
  const attributes = {
    ...callerAttributes,
    ...contractAttributes(options),
    [SDK_LANGUAGE_ATTR]: SDK_LANGUAGE,
    [SDK_INTEGRATION_ATTR]: integration
  };
  return Object.keys(attributes).length > 0 ? attributes : void 0;
}
function normalizeSpan(options, fallbackType) {
  const startedAt = options.startedAt ?? /* @__PURE__ */ new Date();
  const endedAt = options.endedAt ?? /* @__PURE__ */ new Date();
  const error = failureMessage(options.error);
  const usage = toWireTokenUsage(resolveUsage(options));
  return {
    id: options.id,
    parent_id: options.parentId ?? options.parentSpanId,
    name: options.name,
    type: options.type ?? fallbackType,
    input: options.input,
    output: options.output,
    metadata: options.metadata,
    attributes: spanAttributes(options),
    started_at: iso(startedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    ended_at: iso(endedAt) ?? (/* @__PURE__ */ new Date()).toISOString(),
    duration_ms: options.durationMs,
    status: options.status ?? (error ? "ERROR" : void 0),
    error,
    model: options.model,
    tool_name: options.toolName,
    ...usage ? { usage } : {}
  };
}
function warnNoop(message) {
  console.warn(`@uselemma/tracing: ${message}`);
}
function isTraceEndOptions(value) {
  return typeof value === "object" && value !== null && ("output" in value || "durationMs" in value || "startedAt" in value || "endedAt" in value);
}
function coerceDate(value) {
  if (value == null) return void 0;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? void 0 : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? void 0 : parsed;
}
var SpanHandle = class {
  constructor(trace, options, payload, ended = false) {
    this.trace = trace;
    this.options = options;
    this.ended = ended;
    this.id = options.id ?? crypto.randomUUID();
    this.payload = payload ?? this.trace.addSpan({
      ...this.options,
      id: this.id,
      startedAt: this.options.startedAt ?? /* @__PURE__ */ new Date(),
      endedAt: this.options.endedAt ?? null
    });
  }
  id;
  payload;
  end(options = {}) {
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
          endedAt: options.endedAt ?? /* @__PURE__ */ new Date()
        },
        this.options.type ?? "span"
      )
    );
    this.trace.spanEnded(this.payload);
    this.trace.changed();
  }
  /**
   * Extend this span's end time if a child finished later.
   * Only applies after end() — open parents are left alone so a later end()
   * cannot overwrite a premature extension with a shorter duration.
   */
  ensureEndedAt(endedAt) {
    if (!this.ended) return;
    const nextEnd = timestampMs(endedAt);
    const startedMs = timestampMs(this.payload.started_at);
    if (nextEnd == null || startedMs == null) return;
    const currentEnd = timestampMs(this.payload.ended_at) ?? startedMs;
    if (nextEnd <= currentEnd) return;
    this.payload.ended_at = new Date(nextEnd).toISOString();
    this.payload.duration_ms = Math.max(0, nextEnd - startedMs);
    this.trace.changed();
  }
  startSpan(options) {
    const spanOptions = typeof options === "string" ? { name: options } : options;
    return this.trace.startSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id
    });
  }
  startGeneration(options) {
    const generationOptions = typeof options === "string" ? { name: options } : options;
    return this.trace.startGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id
    });
  }
  startTool(options) {
    const toolOptions = typeof options === "string" ? { name: options } : options;
    return this.trace.startTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id
    });
  }
  recordSpan(options) {
    const spanOptions = typeof options === "string" ? { name: options } : options;
    return this.trace.recordSpan({
      ...spanOptions,
      parentId: spanOptions.parentId ?? this.id
    });
  }
  recordGeneration(options) {
    const generationOptions = typeof options === "string" ? { name: options } : options;
    this.trace.recordGeneration({
      ...generationOptions,
      parentId: generationOptions.parentId ?? this.id
    });
  }
  recordTool(options) {
    const toolOptions = typeof options === "string" ? { name: options } : options;
    this.trace.recordTool({
      ...toolOptions,
      parentId: toolOptions.parentId ?? this.id
    });
  }
  span(options) {
    return typeof options === "string" ? this.startSpan(options) : this.recordSpan(options);
  }
  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options) {
    this.recordGeneration(options);
  }
  /** @deprecated Use recordTool() or startTool(). */
  tool(options) {
    this.recordTool(options);
  }
};
var NoopSpanHandle = class {
  id = "";
  end() {
  }
  ensureEndedAt(_endedAt) {
  }
  startSpan() {
    return this;
  }
  startGeneration() {
    return this;
  }
  startTool() {
    return this;
  }
  recordSpan() {
    return this;
  }
  recordGeneration() {
  }
  recordTool() {
  }
  span() {
    return this;
  }
  generation() {
  }
  tool() {
  }
};
var TraceContext = class {
  constructor(options, onChange) {
    this.options = options;
    this.onChange = onChange;
    this.options.name ??= "trace";
    this.options.id ??= crypto.randomUUID();
    this.id = this.options.id;
    this.traceOutput = options.output;
  }
  spans = [];
  traceOutput;
  traceError = null;
  id;
  input(value) {
    this.options.input = value;
    this.changed();
  }
  output(value) {
    this.traceOutput = value;
    this.changed();
  }
  threadId(value) {
    this.options.threadId = value;
    this.changed();
  }
  userId(value) {
    this.options.userId = value;
    this.changed();
  }
  duration(durationMs) {
    this.options.durationMs = durationMs;
    this.changed();
  }
  fail(error) {
    this.traceError = failureMessage(error);
    this.changed();
  }
  changed() {
    this.onChange?.();
  }
  setChangeHandler(onChange) {
    this.onChange = onChange;
  }
  debugSpan(event, span) {
    lemmaDebug("client", event, {
      traceId: this.id,
      span: summarizeSpanForDebug(span)
    });
  }
  addSpan(options, event = "span started") {
    const span = normalizeSpan(options, "span");
    this.spans.push(span);
    this.debugSpan(event, span);
    this.changed();
    return span;
  }
  spanEnded(span) {
    this.debugSpan("span ended", span);
  }
  recordSpan(options) {
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
        endedAt: span.ended_at
      },
      span,
      true
    );
  }
  recordGeneration(options) {
    const generationOptions = typeof options === "string" ? { name: options } : options;
    const span = normalizeSpan(
      { ...generationOptions, type: "generation" },
      "generation"
    );
    this.spans.push(span);
    this.debugSpan("span recorded", span);
    this.changed();
  }
  recordTool(options) {
    const toolOptions = typeof options === "string" ? { name: options } : options;
    const span = normalizeSpan({ ...toolOptions, type: "tool" }, "tool");
    this.spans.push(span);
    this.debugSpan("span recorded", span);
    this.changed();
  }
  startSpan(options) {
    const spanOptions = typeof options === "string" ? { name: options } : options;
    return new SpanHandle(this, {
      ...spanOptions,
      id: spanOptions.id ?? crypto.randomUUID(),
      startedAt: spanOptions.startedAt ?? /* @__PURE__ */ new Date()
    });
  }
  startGeneration(options) {
    return this.startSpan({ ...options, type: "generation" });
  }
  startTool(options) {
    return new SpanHandle(this, {
      ...options,
      type: "tool",
      id: options.id ?? crypto.randomUUID(),
      startedAt: options.startedAt ?? /* @__PURE__ */ new Date()
    });
  }
  span(options) {
    return typeof options === "string" ? this.startSpan(options) : this.recordSpan(options);
  }
  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options) {
    this.recordGeneration(options);
  }
  /** @deprecated Use recordTool() or startTool(). */
  tool(options) {
    this.recordTool(options);
  }
  /**
   * Stamp operation-result token usage onto generation spans that omitted it.
   * Does not invent zeros or overwrite usage already recorded on a span.
   */
  applyGenerationUsage(result) {
    const generations = this.spans.filter((span) => span.type === "generation");
    const stamped = attachResultUsage(generations, result);
    if (stamped > 0) this.changed();
    return stamped;
  }
  toPayload(projectId, startedAt, endedAt) {
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
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: this.options.durationMs ?? elapsedMs(startedAt, endedAt),
        status: this.traceError ? "ERROR" : void 0,
        error: this.traceError,
        spans: this.spans
      }
    };
  }
};
var TraceHandle = class extends TraceContext {
  constructor(options, sendFn, startedAt) {
    super(options);
    this.sendFn = sendFn;
    this.startedAt = startedAt ?? coerceDate(options.startedAt) ?? /* @__PURE__ */ new Date();
  }
  sendPromise = Promise.resolve();
  ended = false;
  startedAt;
  async end(outputOrOptions) {
    if (this.ended) return this.sendPromise;
    let endedAtOverride;
    let startedAtOverride;
    if (isTraceEndOptions(outputOrOptions)) {
      if ("output" in outputOrOptions) {
        this.output(outputOrOptions.output);
      }
      if (outputOrOptions.durationMs != null) {
        this.duration(outputOrOptions.durationMs);
      }
      startedAtOverride = coerceDate(outputOrOptions.startedAt);
      endedAtOverride = coerceDate(outputOrOptions.endedAt);
    } else if (arguments.length > 0) {
      this.output(outputOrOptions);
    }
    this.ended = true;
    const startedAt = startedAtOverride ?? this.startedAt;
    const endedAt = endedAtOverride ?? /* @__PURE__ */ new Date();
    this.sendPromise = this.sendPromise.then(
      () => this.sendFn(this, startedAt, endedAt)
    );
    await this.sendPromise;
  }
  /** Whether this trace has already been delivered via `end()`. */
  get isEnded() {
    return this.ended;
  }
};
var Lemma = class {
  apiKey;
  projectId;
  baseUrl;
  fetchImpl;
  release;
  traces = /* @__PURE__ */ new Map();
  configLogged = false;
  constructor(options = {}) {
    this.apiKey = required(
      options.apiKey ?? process.env.LEMMA_API_KEY,
      "LEMMA_API_KEY"
    );
    this.projectId = required(
      options.projectId ?? process.env.LEMMA_PROJECT_ID,
      "LEMMA_PROJECT_ID"
    );
    this.baseUrl = (options.baseUrl ?? "https://api.uselemma.ai").replace(
      /\/+$/,
      ""
    );
    this.fetchImpl = options.fetch ?? fetch;
    this.release = normalizeRelease(
      options.release ?? process.env.LEMMA_RELEASE
    );
    this.logInitConfigOnce();
  }
  /**
   * Run a one-call delivery diagnostic: config check, minimal ingest, and
   * per-trace ingest-status poll (enqueued / ingested / ready).
   */
  async debugSmokeTest() {
    const configWarnings = buildConfigWarnings(this.baseUrl, this.projectId);
    const hints = [...configWarnings];
    const config = {
      baseUrl: this.baseUrl,
      projectId: this.projectId,
      apiKeySuffix: apiKeySuffix(this.apiKey),
      ingestPath: INGEST_PATH,
      expectedSuccessStatus: EXPECTED_INGEST_SUCCESS_STATUS,
      warnings: configWarnings
    };
    const traceId = crypto.randomUUID();
    const context = new TraceContext({
      id: traceId,
      name: "lemma-debug-smoke-test",
      input: "smoke-test"
    });
    context.output("ok");
    const startedAt = /* @__PURE__ */ new Date();
    const payload = this.stampRelease(
      context.toPayload(this.projectId, startedAt, /* @__PURE__ */ new Date())
    );
    const body = JSON.stringify(payload);
    const url = `${this.baseUrl}${INGEST_PATH}`;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body
      });
    } catch {
      hints.push("ingest request failed (network error)");
      return {
        ok: false,
        config,
        hints
      };
    }
    const responseHeaders = pickResponseHeaders(response.headers);
    const ingestWarnings = [];
    if (response.status !== EXPECTED_INGEST_SUCCESS_STATUS) {
      ingestWarnings.push(
        `expected status ${EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status}`
      );
      const hint = ingestFailureHint(response.status);
      if (hint) hints.push(hint);
    }
    if (!responseHeaders["cf-ray"]) {
      hints.push(
        "missing cf-ray response header (may not be Lemma production)"
      );
    }
    const ingest = {
      status: response.status,
      traceId,
      projectId: this.projectId,
      url,
      responseHeaders,
      warnings: ingestWarnings
    };
    if (!response.ok) {
      hints.push(`ingest failed with status ${response.status}`);
      return {
        ok: false,
        config,
        ingest,
        hints
      };
    }
    const ingestStatus = await this.pollIngestStatus(traceId);
    if (ingestStatus === null) {
      hints.push("ingest-status check failed after ingest (status/network)");
    } else if (!isSuccessfulIngestStatus(ingestStatus)) {
      hints.push(
        `ingest returned 201 but ingest-status=not_found after ${INGEST_STATUS_POLL_TIMEOUT_MS / 1e3}s \u2014 may be processing lag or downstream issue`
      );
    }
    return {
      ok: response.status === EXPECTED_INGEST_SUCCESS_STATUS && isSuccessfulIngestStatus(ingestStatus),
      config,
      ingest,
      ingestStatus: ingestStatus ?? void 0,
      hints
    };
  }
  trace(options = {}, fn) {
    const traceOptions = typeof options === "string" ? { name: options } : options;
    if (!fn) {
      const handle = new TraceHandle(
        traceOptions,
        async (trace, startedAt2, endedAt) => {
          try {
            await this.flushTrace(trace, startedAt2, endedAt);
          } finally {
            this.traces.delete(trace.id);
          }
        }
      );
      this.traces.set(handle.id, handle);
      lemmaDebug("client", "trace handle created", {
        traceId: handle.id,
        name: traceOptions.name ?? "trace"
      });
      return handle;
    }
    const context = new TraceContext(traceOptions);
    const startedAt = /* @__PURE__ */ new Date();
    lemmaDebug("client", "trace started", {
      traceId: context.id,
      name: traceOptions.name ?? "trace"
    });
    return (async () => {
      try {
        const result = await fn(context);
        if (traceOptions.output === void 0) {
          context.output(result);
        }
        await this.flushTrace(context, startedAt, /* @__PURE__ */ new Date());
        return result;
      } catch (error) {
        context.fail(error);
        await this.flushTrace(context, startedAt, /* @__PURE__ */ new Date());
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
   * Deliver **one complete trace** when the execution (agent turn) finishes:
   * root input/output, thread/user, and all child spans in a single call. This
   * is required — patching a trace over time is not supported. Omitted root
   * fields do not preserve prior values, and after Lemma processes the trace
   * once, a later re-delivery does not re-run issue extraction (late new span
   * IDs may still append for display). Retries of the same complete payload are
   * safe: already-stored span IDs are skipped. Throws on a non-2xx response and
   * never mutates the trace's status, so a failed send can be retried as-is.
   */
  async ingest(context, options) {
    await this.flushTrace(
      context,
      options.startedAt,
      options.endedAt ?? /* @__PURE__ */ new Date()
    );
  }
  recordSpan(options) {
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
        "span has a parent, but parentSpanId was not provided; skipping span"
      );
      return new NoopSpanHandle();
    }
    return context.recordSpan({
      name: "span",
      ...spanOptions,
      parentId: parentSpanId ?? null
    });
  }
  recordGeneration(options) {
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
        "generation has a parent, but parentSpanId was not provided; skipping generation"
      );
      return;
    }
    context.recordGeneration({
      name: "generation",
      ...generationOptions,
      parentId: parentSpanId ?? null
    });
  }
  recordTool(options) {
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
        "tool has a parent, but parentSpanId was not provided; skipping tool"
      );
      return;
    }
    context.recordTool({
      name: "tool",
      ...toolOptions,
      parentId: parentSpanId ?? null
    });
  }
  startSpan(options) {
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
        "span has a parent, but parentSpanId was not provided; skipping span"
      );
      return new NoopSpanHandle();
    }
    return context.startSpan({
      name: "span",
      ...spanOptions,
      parentId: parentSpanId ?? null
    });
  }
  startGeneration(options) {
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
        "generation has a parent, but parentSpanId was not provided; skipping generation"
      );
      return new NoopSpanHandle();
    }
    return context.startGeneration({
      name: "generation",
      ...generationOptions,
      parentId: parentSpanId ?? null
    });
  }
  startTool(options) {
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
        "tool has a parent, but parentSpanId was not provided; skipping tool"
      );
      return new NoopSpanHandle();
    }
    return context.startTool({
      name: "tool",
      ...toolOptions,
      parentId: parentSpanId ?? null
    });
  }
  /** @deprecated Use startSpan() or recordSpan(). */
  span(options) {
    return this.recordSpan(options);
  }
  /** @deprecated Use recordGeneration() or startGeneration(). */
  generation(options) {
    this.recordGeneration(options);
  }
  /** @deprecated Use recordTool() or startTool(). */
  tool(options) {
    this.recordTool(options);
  }
  traceFor(traceId) {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`@uselemma/tracing: unknown trace id "${traceId}"`);
    }
    return trace;
  }
  detachedTraceFor(traceId, kind) {
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
  logInitConfigOnce() {
    if (!isDebugModeEnabled() || this.configLogged) return;
    this.configLogged = true;
    const warnings = buildConfigWarnings(this.baseUrl, this.projectId);
    lemmaDebug("client", "initialized", {
      baseUrl: this.baseUrl,
      projectId: this.projectId,
      apiKey: apiKeySuffix(this.apiKey),
      ingestPath: INGEST_PATH,
      expectedSuccessStatus: EXPECTED_INGEST_SUCCESS_STATUS,
      ...warnings.length ? { warnings } : {}
    });
  }
  async fetchIngestStatus(otelTraceId) {
    const url = `${this.baseUrl}${INGEST_STATUS_PATH}?project_id=${encodeURIComponent(this.projectId)}&otel_trace_id=${encodeURIComponent(otelTraceId)}`;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      if (!response.ok) return null;
      const data = await response.json();
      return parseIngestStatus(data.status);
    } catch {
      return null;
    }
  }
  /**
   * Poll ingest-status immediately, then every 1s until success, hard failure,
   * or the 15s timeout.
   */
  async pollIngestStatus(otelTraceId) {
    const deadline = Date.now() + INGEST_STATUS_POLL_TIMEOUT_MS;
    for (; ; ) {
      const status = await this.fetchIngestStatus(otelTraceId);
      if (status === null) return null;
      if (isSuccessfulIngestStatus(status)) return status;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return status;
      await sleep(Math.min(INGEST_STATUS_POLL_INTERVAL_MS, remaining));
    }
  }
  async verifyIngestDelivery(otelTraceId) {
    const result = await this.pollIngestStatus(otelTraceId);
    if (result === null) {
      lemmaDebug(
        "verify",
        "ingest accepted (201), ingest-status check failed (status/network)"
      );
      return;
    }
    if (isSuccessfulIngestStatus(result)) {
      lemmaDebug(
        "verify",
        `ingest accepted (201), trace ${result === "enqueued" ? "enqueued" : `visible (${result})`} (status=${result})`
      );
      return;
    }
    lemmaDebug(
      "verify",
      `ingest accepted (201), ingest-status=not_found after ${INGEST_STATUS_POLL_TIMEOUT_MS / 1e3}s \u2014 may be processing lag or downstream issue`
    );
  }
  stampRelease(payload) {
    if (this.release) payload.trace.release = this.release;
    return payload;
  }
  async flushTrace(context, startedAt, endedAt) {
    const payload = this.stampRelease(
      context.toPayload(this.projectId, startedAt, endedAt)
    );
    const body = JSON.stringify(payload);
    const url = `${this.baseUrl}${INGEST_PATH}`;
    lemmaDebug("client", "sending trace", {
      traceId: payload.trace.id,
      name: payload.trace.name,
      spanCount: payload.trace.spans.length,
      projectId: payload.project_id,
      bodyBytes: new TextEncoder().encode(body).length,
      requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
      url
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body
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
        ...hint ? { hint } : {}
      });
      throw new Error(
        `@uselemma/tracing: failed to ingest trace (${response.status})${responseBody ? `: ${responseBody}` : ""}`
      );
    }
    const sentWarnings = [];
    if (response.status !== EXPECTED_INGEST_SUCCESS_STATUS) {
      sentWarnings.push(
        `expected status ${EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status} (wrong endpoint?)`
      );
    }
    lemmaDebug("client", "trace sent", {
      traceId: payload.trace.id,
      projectId: payload.project_id,
      status: response.status,
      ...responseHeaders,
      ...sentWarnings.length ? { warnings: sentWarnings } : {}
    });
    if (isDebugModeEnabled() && isDebugVerifyEnabled() && payload.trace.id) {
      await this.verifyIngestDelivery(payload.trace.id);
    }
  }
};

// ../../packages/ts/tracing/src/coding-agent.ts
function requireOpen(turn) {
  if (turn.status === "completed") {
    throw new Error(
      `Coding agent turn ${turn.sessionId}/${turn.turnId} already completed`
    );
  }
  return turn;
}
function harnessAttributes(turn) {
  return {
    "lemma.harness.id": turn.harness,
    "lemma.harness.session_id": turn.sessionId,
    "lemma.harness.turn_id": turn.turnId,
    "lemma.sdk.integration": "coding-agent"
  };
}
function startCodingAgentTurn(options) {
  return {
    version: 1,
    status: "open",
    harness: options.harness,
    sessionId: options.sessionId,
    turnId: options.turnId,
    traceId: options.traceId ?? crypto.randomUUID(),
    generationId: options.generationId ?? crypto.randomUUID(),
    prompt: options.prompt,
    startedAt: options.startedAt,
    model: options.model,
    provider: options.provider,
    metadata: options.metadata,
    tools: []
  };
}
function recordCodingAgentToolStart(turn, event) {
  const open = requireOpen(turn);
  if (open.tools.some((tool) => tool.toolUseId === event.toolUseId)) {
    return open;
  }
  return {
    ...open,
    tools: [
      ...open.tools,
      {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
        startedAt: event.startedAt
      }
    ]
  };
}
function recordCodingAgentToolResult(turn, event) {
  const open = requireOpen(turn);
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId
  );
  const completed = {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    input: event.input ?? (existingIndex >= 0 ? open.tools[existingIndex].input : void 0),
    output: event.output,
    error: event.error,
    startedAt: existingIndex >= 0 ? open.tools[existingIndex].startedAt : event.endedAt,
    endedAt: event.endedAt
  };
  if (existingIndex < 0) {
    return { ...open, tools: [...open.tools, completed] };
  }
  const tools = [...open.tools];
  tools[existingIndex] = completed;
  return { ...open, tools };
}
function completeCodingAgentTurn(turn, event) {
  if (turn.status === "completed") return turn;
  return {
    ...turn,
    status: "completed",
    response: event.response,
    endedAt: event.endedAt,
    model: event.model ?? turn.model,
    provider: event.provider ?? turn.provider
  };
}
function codingAgentTurnTrace(turn) {
  const attributes = harnessAttributes(turn);
  const context = new TraceContext({
    id: turn.traceId,
    name: `${turn.harness} coding agent`,
    input: turn.prompt,
    output: turn.response,
    threadId: turn.sessionId,
    startedAt: turn.startedAt,
    metadata: {
      ...turn.metadata ?? {},
      ...attributes
    }
  });
  for (const tool of turn.tools) {
    context.recordTool({
      id: tool.toolUseId,
      name: tool.toolName,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      error: tool.error,
      status: tool.error === void 0 ? "OK" : "ERROR",
      startedAt: tool.startedAt,
      endedAt: tool.endedAt ?? tool.startedAt,
      attributes,
      metadata: { tool_use_id: tool.toolUseId }
    });
  }
  context.recordGeneration({
    id: turn.generationId,
    name: `${turn.harness} response`,
    input: turn.prompt,
    output: turn.response,
    model: turn.model,
    llmProvider: turn.provider,
    llmInputMessages: [{ role: "user", content: turn.prompt }],
    llmOutputMessages: [{ role: "assistant", content: turn.response }],
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    attributes
  });
  return {
    context,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt
  };
}

// src/storage.ts
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function safeId(value) {
  return createHash("sha256").update(value).digest("hex");
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return options.dataDir;
  const env = options.env ?? process.env;
  const override = env.LEMMA_CODEX_DATA_DIR?.trim();
  if (override) return override;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Lemma", "Codex");
  }
  if (platform === "win32") {
    return join(
      env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || join(home, "AppData", "Local"),
      "Lemma",
      "Codex"
    );
  }
  return join(
    env.XDG_STATE_HOME?.trim() || join(home, ".local", "state"),
    "lemma",
    "codex"
  );
}
async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 448 });
  if (process.platform !== "win32") await chmod(path, 448);
}
async function writeSecureJson(path, value) {
  const parent = dirname(path);
  await ensurePrivateDirectory(parent);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  if (process.platform !== "win32") await chmod(temporaryPath, 384);
  await rename(temporaryPath, path);
  if (process.platform !== "win32") await chmod(path, 384);
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && typeof value.projectId === "string" && typeof value.credentialId === "string" && typeof value.accessToken === "string";
}
function isCodingAgentTurn(value) {
  return isRecord(value) && value.version === 1 && (value.status === "open" || value.status === "completed") && typeof value.harness === "string" && typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.traceId === "string" && typeof value.generationId === "string" && typeof value.prompt === "string" && typeof value.startedAt === "string" && Array.isArray(value.tools) && (value.status === "open" || typeof value.response === "string" && typeof value.endedAt === "string");
}
function credentialsPath(dataDir) {
  return join(dataDir, "credentials.json");
}
function turnPath(dataDir, sessionId, turnId) {
  return join(dataDir, "turns", `${safeId(`${sessionId}\0${turnId}`)}.json`);
}
function pendingPath(dataDir, traceId) {
  return join(dataDir, "pending", `${safeId(traceId)}.json`);
}
async function readCredentials(dataDir) {
  const value = await readJson(credentialsPath(dataDir));
  if (value === null) return null;
  if (!isCredentials(value))
    throw new Error("Lemma Codex credentials are invalid");
  return value;
}
async function readTurn(dataDir, sessionId, turnId) {
  const value = await readJson(turnPath(dataDir, sessionId, turnId));
  if (value === null) return null;
  if (!isCodingAgentTurn(value))
    throw new Error("Lemma Codex turn state is invalid");
  return value;
}
async function writeTurn(dataDir, turn) {
  await writeSecureJson(turnPath(dataDir, turn.sessionId, turn.turnId), turn);
}
async function queueCompletedTurn(dataDir, turn) {
  await writeSecureJson(pendingPath(dataDir, turn.traceId), turn);
}
async function removeTurn(dataDir, sessionId, turnId) {
  await unlink(turnPath(dataDir, sessionId, turnId)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
async function listPendingTurns(dataDir) {
  const directory = join(dataDir, "pending");
  const entries = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const pending = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(directory, entry);
    const value = await readJson(path);
    if (!isCodingAgentTurn(value) || value.status !== "completed") {
      throw new Error(`Lemma Codex pending turn is invalid: ${entry}`);
    }
    pending.push({ path, turn: value });
  }
  return pending;
}
async function removePending(path) {
  await unlink(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
function sleep2(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
async function withSessionLock(dataDir, sessionId, callback) {
  const lockDirectory = join(dataDir, "locks", `${safeId(sessionId)}.lock`);
  await ensurePrivateDirectory(dirname(lockDirectory));
  const deadline = Date.now() + 2e3;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 448 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lockStat = await stat(lockDirectory).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 3e4) {
        await rmdir(lockDirectory).catch(() => void 0);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for Lemma Codex turn state lock");
      }
      await sleep2(20);
    }
  }
  try {
    return await callback();
  } finally {
    await rmdir(lockDirectory).catch(() => void 0);
  }
}

// src/hook-handler.ts
function stringField(input, name) {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function eventName(input) {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "Stop":
      return input.hook_event_name;
    default:
      return null;
  }
}
function isMainAgent(input) {
  return !(stringField(input, "agent_id") || stringField(input, "subagent_id") || stringField(input, "parent_session_id") || input.agent_type === "subagent");
}
function eventTimestamp(input, now) {
  const supplied = stringField(input, "timestamp");
  if (supplied && !Number.isNaN(Date.parse(supplied))) {
    return new Date(supplied).toISOString();
  }
  return now().toISOString();
}
function turnMetadata(input) {
  return {
    ...stringField(input, "cwd") ? { "lemma.harness.cwd": stringField(input, "cwd") } : {},
    ...stringField(input, "transcript_path") ? {
      "lemma.harness.transcript_path": stringField(
        input,
        "transcript_path"
      )
    } : {}
  };
}
function toolOutput(input) {
  return input.tool_response ?? input.tool_output ?? input.response;
}
function toolError(input) {
  if (input.error !== void 0) return input.error;
  const output = toolOutput(input);
  if (typeof output === "object" && output !== null && "error" in output) {
    return output.error;
  }
  return void 0;
}
async function defaultSendTrace(input) {
  const lemma = new Lemma({
    apiKey: input.accessToken,
    projectId: input.projectId,
    baseUrl: input.apiUrl
  });
  const trace = codingAgentTurnTrace(input.turn);
  await lemma.ingest(trace.context, {
    startedAt: new Date(trace.startedAt),
    endedAt: new Date(trace.endedAt)
  });
}
async function flushPendingTurns(dependencies = {}) {
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const credentials = await readCredentials(dataDir);
  if (!credentials) return 0;
  const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
  let sent = 0;
  for (const pending of await listPendingTurns(dataDir)) {
    await sendTrace({
      apiUrl: credentials.apiUrl,
      projectId: credentials.projectId,
      accessToken: credentials.accessToken,
      turn: pending.turn
    });
    await removePending(pending.path);
    sent += 1;
  }
  return sent;
}
async function flushWithoutBlockingEvent(dependencies) {
  try {
    await flushPendingTurns(dependencies);
  } catch (error) {
    dependencies.warn?.(
      `Lemma Codex retained a trace for retry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function handleCodexHook(input, dependencies = {}) {
  const event = eventName(input);
  if (!event || !isMainAgent(input)) return { status: "ignored" };
  const sessionId = stringField(input, "session_id");
  const turnId = stringField(input, "turn_id");
  if (!sessionId || !turnId) return { status: "ignored" };
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  if (event === "UserPromptSubmit") {
    await flushWithoutBlockingEvent(dependencies);
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      if (await readTurn(dataDir, sessionId, turnId)) return;
      await writeTurn(
        dataDir,
        startCodingAgentTurn({
          harness: "codex",
          sessionId,
          turnId,
          prompt,
          startedAt: eventTimestamp(input, now),
          model: stringField(input, "model"),
          provider: "openai",
          metadata: turnMetadata(input)
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "PreToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await readTurn(dataDir, sessionId, turnId);
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolStart(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          startedAt: eventTimestamp(input, now)
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "PostToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await readTurn(dataDir, sessionId, turnId);
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          output: toolOutput(input),
          error: toolError(input),
          endedAt: eventTimestamp(input, now)
        })
      );
    });
    return { status: "recorded", event };
  }
  const response = stringField(input, "last_assistant_message") ?? "";
  let traceId = null;
  await withSessionLock(dataDir, sessionId, async () => {
    const turn = await readTurn(dataDir, sessionId, turnId);
    if (!turn) return;
    const completed = completeCodingAgentTurn(turn, {
      response,
      endedAt: eventTimestamp(input, now),
      model: stringField(input, "model"),
      provider: "openai"
    });
    await queueCompletedTurn(dataDir, completed);
    await removeTurn(dataDir, sessionId, turnId);
    traceId = completed.traceId;
  });
  await flushWithoutBlockingEvent(dependencies);
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}

// src/hook-entry.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  try {
    delete process.env.LEMMA_DEBUG;
    delete process.env.LEMMA_DEBUG_VERIFY;
    const raw = await readStdin();
    const input = JSON.parse(raw);
    await handleCodexHook(input, {
      warn: (message) => stderr.write(`${message}
`)
    });
  } catch (error) {
    stderr.write(
      `Lemma Codex hook failed open: ${error instanceof Error ? error.message : String(error)}
`
    );
  }
  stdout.write("{}\n");
}
await main();
