// src/flush.ts
import { randomUUID } from "node:crypto";
import {
  mkdir as mkdir2,
  readFile as readFile2,
  readdir,
  rm,
  stat,
  unlink as unlink2,
  writeFile as writeFile2
} from "node:fs/promises";
import { join as join2 } from "node:path";

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
  return new Promise((resolve2) => setTimeout(resolve2, ms));
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
  const modelIdentity = options.llmModelName ?? options.model;
  addDefined(attributes, "llm.model_name", modelIdentity);
  addDefined(attributes, "gen_ai.request.model", modelIdentity);
  addDefined(attributes, "ai.model.id", modelIdentity);
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
  const startedAt = options.startedAt === void 0 ? /* @__PURE__ */ new Date() : options.startedAt;
  const endedAt = options.endedAt === void 0 ? /* @__PURE__ */ new Date() : options.endedAt;
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
    ...startedAt === null ? {} : { started_at: iso(startedAt) },
    ...endedAt === null ? {} : { ended_at: iso(endedAt) },
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
          endedAt: options.endedAt ?? /* @__PURE__ */ new Date(),
          // Keep a start-time model when end() omits it or would overwrite
          // with undefined. Fill in from the response only when unset.
          model: this.options.model ?? options.model
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
  deliveryWarningLogged = false;
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
      let result;
      try {
        result = await fn(context);
      } catch (error) {
        context.fail(error);
        await this.flushWithoutMasking(context, startedAt, /* @__PURE__ */ new Date());
        throw error;
      }
      if (traceOptions.output === void 0) {
        context.output(result);
      }
      await this.flushTrace(context, startedAt, /* @__PURE__ */ new Date());
      return result;
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
  /**
   * Deliver a trace without letting a delivery failure replace the caller's error.
   *
   * Called only from a `catch` block that is about to rethrow. If `flushTrace`
   * threw from there, the ingest error would propagate in place of the agent's
   * error and the caller would lose the failure they are handling.
   */
  async flushWithoutMasking(context, startedAt, endedAt) {
    try {
      await this.flushTrace(context, startedAt, endedAt);
    } catch (flushError) {
      if (this.deliveryWarningLogged) return;
      this.deliveryWarningLogged = true;
      warnNoop(
        `could not deliver the trace for a failed run (${describeError(flushError)}); rethrowing the original error. Further delivery failures on this path are not repeated.`
      );
    }
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
import { createHash } from "node:crypto";
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
function deterministicUuid(value) {
  const hash = createHash("sha256").update(value).digest("hex");
  const variant = (8 + Number.parseInt(hash[16], 16) % 4).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function turnIdentity(options) {
  return `${options.harness}\0${options.sessionId}\0${options.turnId}`;
}
function startCodingAgentTurn(options) {
  return {
    version: 1,
    status: "open",
    harness: options.harness,
    sessionId: options.sessionId,
    turnId: options.turnId,
    traceId: options.traceId ?? deterministicUuid(`lemma-coding-agent-trace\0${turnIdentity(options)}`),
    generationId: options.generationId ?? deterministicUuid(
      `lemma-coding-agent-generation\0${turnIdentity(options)}`
    ),
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
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId
  );
  if (existingIndex >= 0) {
    const existing = open.tools[existingIndex];
    if (!existing.startTimeMissing) return open;
    const tools = [...open.tools];
    tools[existingIndex] = {
      ...existing,
      toolName: event.toolName,
      input: event.input === void 0 ? existing.input : event.input,
      startedAt: event.startedAt,
      startTimeMissing: void 0
    };
    return { ...open, tools };
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
    input: event.input === void 0 && existingIndex >= 0 ? open.tools[existingIndex].input : event.input,
    output: event.output,
    error: failureMessage(event.error) ?? void 0,
    startedAt: existingIndex >= 0 ? open.tools[existingIndex].startedAt : void 0,
    endedAt: event.endedAt,
    startTimeMissing: existingIndex >= 0 ? open.tools[existingIndex].startTimeMissing : true
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
  if (event.generationStartedAt === void 0 !== (event.generationEndedAt === void 0)) {
    throw new Error(
      "Coding agent generation timing requires both startedAt and endedAt"
    );
  }
  const tools = turn.tools.map((tool) => {
    const error = failureMessage(tool.error) ?? void 0;
    return tool.endedAt ? { ...tool, error } : { ...tool, error, resultMissing: true };
  });
  return {
    ...turn,
    tools,
    status: "completed",
    response: event.response,
    endedAt: event.endedAt,
    model: event.model ?? turn.model,
    provider: event.provider ?? turn.provider,
    generationStartedAt: event.generationStartedAt,
    generationEndedAt: event.generationEndedAt
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
    const missingStart = tool.startTimeMissing === true || tool.startedAt === void 0;
    const missingResult = tool.resultMissing === true || tool.endedAt === void 0;
    const error = tool.error;
    context.recordTool({
      id: tool.toolUseId,
      name: tool.toolName,
      toolName: tool.toolName,
      input: tool.input,
      output: tool.output,
      error,
      status: error == null ? missingResult ? void 0 : "OK" : "ERROR",
      startedAt: tool.startedAt ?? null,
      endedAt: tool.endedAt ?? null,
      attributes,
      metadata: {
        tool_use_id: tool.toolUseId,
        ...missingStart ? { start_time_missing: true } : {},
        ...missingResult ? { result_missing: true } : {}
      }
    });
  }
  const generationTimingMissing = turn.generationStartedAt === void 0;
  context.recordGeneration({
    id: turn.generationId,
    name: `${turn.harness} response`,
    input: turn.prompt,
    output: turn.response,
    model: turn.model,
    llmProvider: turn.provider,
    llmInputMessages: [{ role: "user", content: turn.prompt }],
    llmOutputMessages: [{ role: "assistant", content: turn.response }],
    startedAt: turn.generationStartedAt ?? null,
    endedAt: turn.generationEndedAt ?? null,
    attributes,
    metadata: generationTimingMissing ? { timing_missing: true } : void 0
  });
  return {
    context,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt
  };
}

// src/delivery.ts
var DELIVERY_TIMEOUT_MS = 1e4;
function createDeliveryFetch(fetchImplementation = fetch, timeoutMilliseconds = DELIVERY_TIMEOUT_MS) {
  return async (request, init) => {
    const controller = new AbortController();
    const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    let timeout;
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Lemma OpenClaw trace delivery timed out"));
      }, timeoutMilliseconds);
    });
    try {
      return await Promise.race([
        fetchImplementation(request, { ...init, signal }),
        timedOut
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

// src/storage.ts
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var LEMMA_OPENCLAW_CREDENTIALS_HELP = "Lemma OpenClaw credentials are missing or invalid. Run `pnpm dlx @uselemma/openclaw setup` to connect or rotate the scoped credential.";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && value.apiUrl.length > 0 && typeof value.projectId === "string" && value.projectId.length > 0 && typeof value.credentialId === "string" && value.credentialId.length > 0 && typeof value.accessToken === "string" && value.accessToken.length > 0;
}
function resolveOpenClawStateDir(options = {}) {
  if (options.stateDir) return resolve(options.stateDir);
  const env = options.env ?? process.env;
  const configured = env.OPENCLAW_STATE_DIR?.trim();
  if (configured) return resolve(configured);
  const home = env.OPENCLAW_HOME?.trim() || options.homeDir || homedir();
  const current = join(resolve(home), ".openclaw");
  const legacy = join(resolve(home), ".clawdbot");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}
function defaultDataDir(options) {
  return join(resolveOpenClawStateDir(options), "lemma");
}
function dataDirLocationPath(options) {
  return join(defaultDataDir(options), "data-dir-location.json");
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return resolve(options.dataDir);
  const env = options.env ?? process.env;
  const configured = env.LEMMA_OPENCLAW_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  const fallback = defaultDataDir(options);
  try {
    const value = JSON.parse(
      readFileSync(dataDirLocationPath(options), "utf8")
    );
    if (isRecord(value) && value.version === 1 && typeof value.dataDir === "string" && value.dataDir.trim().length > 0) {
      return resolve(value.dataDir);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return fallback;
}
function credentialsPath(options = {}) {
  return join(resolveDataDir(options), "credentials.json");
}
async function readCredentials(options = {}) {
  try {
    const value = JSON.parse(
      await readFile(credentialsPath(options), "utf8")
    );
    if (!isCredentials(value)) throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
    }
    throw error;
  }
}

// src/flush.ts
var FLUSH_LOCK_STALE_MS = 3e4;
var FLUSH_LOCK_OWNER_FILE = "owner.json";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOpenClawTurn(value) {
  return isRecord2(value) && value.version === 1 && typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.prompt === "string" && typeof value.response === "string" && typeof value.startedAt === "string" && typeof value.endedAt === "string" && Array.isArray(value.tools);
}
function isPendingTurn(value) {
  return isRecord2(value) && value.version === 1 && typeof value.apiUrl === "string" && typeof value.projectId === "string" && isOpenClawTurn(value.turn);
}
function mapOpenClawTurn(turn) {
  let mapped = startCodingAgentTurn({
    harness: "openclaw",
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    prompt: turn.prompt,
    startedAt: turn.startedAt,
    model: turn.model,
    provider: turn.provider,
    metadata: {
      "lemma.harness.session_event_source": "native-plugin-hooks",
      ...turn.metadata ?? {}
    }
  });
  for (const tool of turn.tools) {
    if (tool.startedAt) {
      mapped = recordCodingAgentToolStart(mapped, {
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        input: tool.input,
        startedAt: tool.startedAt
      });
    }
    if (tool.endedAt) {
      mapped = recordCodingAgentToolResult(mapped, {
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        input: tool.input,
        output: tool.output,
        error: tool.error,
        endedAt: tool.endedAt
      });
    }
  }
  return completeCodingAgentTurn(mapped, {
    response: turn.response,
    endedAt: turn.endedAt,
    model: turn.model,
    provider: turn.provider
  });
}
async function acquireFlushLock(dataDir) {
  await mkdir2(dataDir, { recursive: true, mode: 448 });
  const lockPath = join2(dataDir, "flush.lock");
  const ownerPath = join2(lockPath, FLUSH_LOCK_OWNER_FILE);
  const owner = { pid: process.pid, id: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir2(lockPath, { mode: 448 });
      await writeFile2(ownerPath, `${JSON.stringify(owner)}
`, {
        encoding: "utf8",
        mode: 384,
        flag: "wx"
      });
      return async () => {
        const currentOwner = await readLockOwner(ownerPath);
        if (currentOwner?.id === owner.id) {
          await rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt > 0) return null;
      const currentOwner = await readLockOwner(ownerPath);
      if (currentOwner && processIsRunning(currentOwner.pid)) return null;
      const lockStat = await stat(lockPath).catch((statError) => {
        if (statError.code === "ENOENT") return null;
        throw statError;
      });
      if (lockStat && Date.now() - lockStat.mtimeMs <= FLUSH_LOCK_STALE_MS) {
        return null;
      }
      await rm(lockPath, { recursive: true, force: true });
    }
  }
  return null;
}
async function readLockOwner(path) {
  try {
    const value = JSON.parse(await readFile2(path, "utf8"));
    if (isRecord2(value) && typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 && typeof value.id === "string" && value.id.length > 0) {
      return { pid: value.pid, id: value.id };
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return null;
}
function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function pendingEntryNames(dataDir) {
  return readdir(join2(dataDir, "pending")).then((entries) => entries.filter((name) => name.endsWith(".json")).sort()).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}
async function flushPendingTurns(options = {}) {
  const dataDir = resolveDataDir(options);
  let sent = 0;
  const attemptedEntries = /* @__PURE__ */ new Set();
  while (true) {
    const releaseLock = await acquireFlushLock(dataDir);
    if (!releaseLock) return sent;
    try {
      const credentials = await readCredentials({ ...options, dataDir });
      if (!credentials) throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
      const pendingDir = join2(dataDir, "pending");
      for (const entry of (await pendingEntryNames(dataDir)).filter(
        (name) => !attemptedEntries.has(name)
      )) {
        attemptedEntries.add(entry);
        const path = join2(pendingDir, entry);
        try {
          const pending = JSON.parse(await readFile2(path, "utf8"));
          if (!isPendingTurn(pending)) throw new Error("invalid pending turn");
          if (pending.apiUrl !== credentials.apiUrl || pending.projectId !== credentials.projectId) {
            throw new Error("pending turn belongs to a different scoped credential");
          }
          const trace = codingAgentTurnTrace(mapOpenClawTurn(pending.turn));
          await new Lemma({
            apiKey: credentials.accessToken,
            projectId: credentials.projectId,
            baseUrl: credentials.apiUrl,
            fetch: createDeliveryFetch(options.fetch)
          }).ingest(trace.context, {
            startedAt: new Date(trace.startedAt),
            endedAt: new Date(trace.endedAt)
          });
          await unlink2(path);
          sent += 1;
        } catch {
          options.warn?.(`Lemma OpenClaw retained a trace for retry (${entry}).`);
        }
      }
    } finally {
      await releaseLock();
    }
    const remainingEntries = await pendingEntryNames(dataDir);
    if (!remainingEntries.some((entry) => !attemptedEntries.has(entry))) {
      return sent;
    }
  }
}

// src/flush-entry.ts
try {
  await flushPendingTurns({
    warn: (message) => console.warn(message)
  });
} catch {
  console.warn(
    "Lemma OpenClaw could not flush pending traces. They will be retried after the next agent run."
  );
}
