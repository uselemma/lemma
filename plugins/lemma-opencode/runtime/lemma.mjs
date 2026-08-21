// @uselemma/opencode managed plugin
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../packages/ts/tracing/dist/debug-delivery.js
var require_debug_delivery = __commonJS({
  "../../packages/ts/tracing/dist/debug-delivery.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.INGEST_STATUS_POLL_TIMEOUT_MS = exports.INGEST_STATUS_POLL_INTERVAL_MS = exports.EXPECTED_INGEST_SUCCESS_STATUS = exports.INGEST_STATUS_PATH = exports.INGEST_PATH = exports.PRODUCTION_BASE_URL = void 0;
    exports.isSuccessfulIngestStatus = isSuccessfulIngestStatus;
    exports.parseIngestStatus = parseIngestStatus;
    exports.isValidProjectId = isValidProjectId;
    exports.apiKeySuffix = apiKeySuffix;
    exports.buildConfigWarnings = buildConfigWarnings;
    exports.ingestFailureHint = ingestFailureHint;
    exports.pickResponseHeaders = pickResponseHeaders;
    exports.pickResponseHeadersFromRecord = pickResponseHeadersFromRecord;
    exports.sleep = sleep;
    exports.PRODUCTION_BASE_URL = "https://api.uselemma.ai";
    exports.INGEST_PATH = "/traces/ingest";
    exports.INGEST_STATUS_PATH = "/traces/ingest-status";
    exports.EXPECTED_INGEST_SUCCESS_STATUS = 201;
    exports.INGEST_STATUS_POLL_INTERVAL_MS = 1e3;
    exports.INGEST_STATUS_POLL_TIMEOUT_MS = 15e3;
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
      if (apiKey.length <= 4)
        return apiKey;
      return `...${apiKey.slice(-4)}`;
    }
    function buildConfigWarnings(baseUrl, projectId) {
      const warnings = [];
      if (baseUrl !== exports.PRODUCTION_BASE_URL) {
        warnings.push(`baseUrl is not production (${exports.PRODUCTION_BASE_URL})`);
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
        if (value)
          picked[name] = value;
      }
      return picked;
    }
    function pickResponseHeadersFromRecord(headers) {
      const lowered = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      const picked = {};
      for (const name of ["cf-ray", "server", "date"]) {
        const value = lowered[name];
        if (value)
          picked[name] = value;
      }
      return picked;
    }
    function sleep(ms) {
      return new Promise((resolve2) => setTimeout(resolve2, ms));
    }
  }
});

// ../../packages/ts/tracing/dist/debug-mode.js
var require_debug_mode = __commonJS({
  "../../packages/ts/tracing/dist/debug-mode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.enableDebugMode = enableDebugMode;
    exports.disableDebugMode = disableDebugMode;
    exports.isDebugModeEnabled = isDebugModeEnabled;
    exports.isDebugVerifyEnabled = isDebugVerifyEnabled;
    exports.lemmaDebug = lemmaDebug;
    var debugModeEnabled = false;
    function isEnvFlagEnabled(name) {
      const value = process.env[name];
      return value === "1" || value === "true";
    }
    function enableDebugMode() {
      debugModeEnabled = true;
    }
    function disableDebugMode() {
      debugModeEnabled = false;
    }
    function isDebugModeEnabled() {
      return debugModeEnabled || isEnvFlagEnabled("LEMMA_DEBUG");
    }
    function isDebugVerifyEnabled() {
      return isEnvFlagEnabled("LEMMA_DEBUG_VERIFY");
    }
    function lemmaDebug(prefix, msg, data) {
      if (!isDebugModeEnabled())
        return;
      if (data !== void 0) {
        console.log(`[LEMMA:${prefix}] ${msg}`, data);
      } else {
        console.log(`[LEMMA:${prefix}] ${msg}`);
      }
    }
  }
});

// ../../packages/ts/tracing/dist/error-message.js
var require_error_message = __commonJS({
  "../../packages/ts/tracing/dist/error-message.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.errorMessage = errorMessage;
    exports.describeError = describeError;
    exports.failureMessage = failureMessage;
    function errorMessage(error) {
      if (error == null)
        return null;
      if (error instanceof Error) {
        return qualify(errorClassName(error), error.message);
      }
      if (typeof error === "string") {
        return error.trim() || null;
      }
      if (typeof error === "object") {
        const record = error;
        if (typeof record.message === "string") {
          return qualify(typeof record.name === "string" ? record.name : void 0, record.message);
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
      if (name && name !== GENERIC_ERROR_NAME)
        return name;
      const constructorName = error.constructor?.name;
      return (typeof constructorName === "string" ? constructorName : void 0) || name || GENERIC_ERROR_NAME;
    }
    function qualify(name, message) {
      const trimmedName = name?.trim();
      const trimmedMessage = messageText(message);
      if (!trimmedMessage)
        return trimmedName || GENERIC_ERROR_NAME;
      if (!trimmedName || trimmedName === GENERIC_ERROR_NAME || trimmedMessage.startsWith(`${trimmedName}:`)) {
        return trimmedMessage;
      }
      return `${trimmedName}: ${trimmedMessage}`;
    }
    function messageText(message) {
      if (typeof message === "string")
        return message.trim();
      if (message == null)
        return "";
      if (typeof message === "object") {
        const text = stringifyObject(message);
        return text === GENERIC_ERROR_NAME ? "" : text;
      }
      return safeText(message);
    }
    function stringifyObject(error) {
      try {
        const json = JSON.stringify(error);
        if (json && json !== "{}")
          return json;
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
  }
});

// ../../packages/ts/tracing/dist/release.js
var require_release = __commonJS({
  "../../packages/ts/tracing/dist/release.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RELEASE_MAX_LENGTH = void 0;
    exports.normalizeRelease = normalizeRelease;
    exports.RELEASE_MAX_LENGTH = 200;
    var CONTROL_CHARS = /[\n\t\r]/;
    function normalizeRelease(value) {
      if (typeof value !== "string")
        return void 0;
      const trimmed = value.trim();
      if (trimmed.length === 0)
        return void 0;
      if (trimmed.length > exports.RELEASE_MAX_LENGTH)
        return void 0;
      if (CONTROL_CHARS.test(trimmed))
        return void 0;
      return trimmed;
    }
  }
});

// ../../packages/ts/tracing/dist/usage.js
var require_usage = __commonJS({
  "../../packages/ts/tracing/dist/usage.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.normalizeTokenUsage = normalizeTokenUsage;
    exports.attachResultUsage = attachResultUsage;
    exports.toWireTokenUsage = toWireTokenUsage;
    exports.tokenUsageAttributes = tokenUsageAttributes;
    function asFiniteNumber(value) {
      if (typeof value !== "number" || !Number.isFinite(value))
        return void 0;
      return value;
    }
    function pickNumber(source, keys) {
      for (const key of keys) {
        const value = asFiniteNumber(source[key]);
        if (value !== void 0)
          return value;
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
      if (raw == null)
        return void 0;
      let source = asRecord(raw);
      if (!source)
        return void 0;
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
        if (!outerHasTokens)
          source = nested;
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
      if (inputTokens !== void 0)
        usage.inputTokens = inputTokens;
      if (outputTokens !== void 0)
        usage.outputTokens = outputTokens;
      if (cacheReadInputTokens !== void 0) {
        usage.cacheReadInputTokens = cacheReadInputTokens;
      }
      if (cacheCreationInputTokens !== void 0) {
        usage.cacheCreationInputTokens = cacheCreationInputTokens;
      }
      if (reasoningOutputTokens !== void 0) {
        usage.reasoningOutputTokens = reasoningOutputTokens;
      }
      if (Object.keys(usage).length === 0)
        return void 0;
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
        return result.rawResponses.map((response) => normalizeTokenUsage(response?.usage));
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
      if (!usage || spanHasUsage(span))
        return false;
      const wire = toWireTokenUsage(usage);
      if (!wire)
        return false;
      span.usage = wire;
      span.attributes = {
        ...span.attributes,
        ...tokenUsageAttributes(usage)
      };
      return true;
    }
    function attachResultUsage(generations, result) {
      if (generations.length === 0)
        return 0;
      const parsed = asUsageResult(result);
      if (!parsed)
        return 0;
      const steps = resultStepUsages(parsed);
      const total = resultTotalUsage(parsed);
      if (generations.length === 1) {
        return stampSpanUsage(generations[0], total ?? steps[0]) ? 1 : 0;
      }
      let stamped = 0;
      for (let i = 0; i < generations.length; i += 1) {
        if (stampSpanUsage(generations[i], steps[i]))
          stamped += 1;
      }
      if (stamped === 0 && total) {
        return stampSpanUsage(generations[0], total) ? 1 : 0;
      }
      return stamped;
    }
    function toWireTokenUsage(usage) {
      if (!usage)
        return void 0;
      const wire = {};
      if (usage.inputTokens !== void 0)
        wire.input_tokens = usage.inputTokens;
      if (usage.outputTokens !== void 0)
        wire.output_tokens = usage.outputTokens;
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
      if (!usage)
        return {};
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
  }
});

// ../../packages/ts/tracing/dist/client.js
var require_client = __commonJS({
  "../../packages/ts/tracing/dist/client.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Lemma = exports.TraceHandle = exports.TraceContext = exports.NoopSpanHandle = exports.SpanHandle = exports.toWireTokenUsage = exports.normalizeTokenUsage = exports.attachResultUsage = void 0;
    var debug_delivery_1 = require_debug_delivery();
    var debug_mode_1 = require_debug_mode();
    var error_message_1 = require_error_message();
    var release_1 = require_release();
    var usage_1 = require_usage();
    var usage_2 = require_usage();
    Object.defineProperty(exports, "attachResultUsage", { enumerable: true, get: function() {
      return usage_2.attachResultUsage;
    } });
    Object.defineProperty(exports, "normalizeTokenUsage", { enumerable: true, get: function() {
      return usage_2.normalizeTokenUsage;
    } });
    Object.defineProperty(exports, "toWireTokenUsage", { enumerable: true, get: function() {
      return usage_2.toWireTokenUsage;
    } });
    var SDK_LANGUAGE = "typescript";
    var SDK_INTEGRATION_ATTR = "lemma.sdk.integration";
    var SDK_LANGUAGE_ATTR = "lemma.sdk.language";
    function required(value, envName) {
      if (value?.trim())
        return value.trim();
      throw new Error(`@uselemma/tracing: Missing ${envName}`);
    }
    function iso(value) {
      if (value == null)
        return value;
      return value instanceof Date ? value.toISOString() : value;
    }
    function timestampMs(value) {
      if (value == null)
        return null;
      const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    function elapsedMs(start, end) {
      const startMs = timestampMs(start);
      const endMs = timestampMs(end);
      if (startMs == null || endMs == null)
        return void 0;
      return Math.max(0, endMs - startMs);
    }
    function summarizeSpanForDebug(span, index) {
      return Object.fromEntries(Object.entries({
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
      }).filter(([, value]) => value !== void 0));
    }
    function serializeAttribute(value) {
      if (value == null)
        return value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    function addDefined(attributes, key, value) {
      if (value !== void 0)
        attributes[key] = value;
    }
    function flattenMessage(attributes, prefix, message) {
      if (message && typeof message === "object" && !Array.isArray(message)) {
        for (const [key, value] of Object.entries(message)) {
          addDefined(attributes, `${prefix}.message.${key}`, serializeAttribute(value));
        }
        return;
      }
      addDefined(attributes, `${prefix}.message.content`, serializeAttribute(message));
    }
    function flattenDocument(attributes, prefix, document) {
      if (document && typeof document === "object" && !Array.isArray(document)) {
        for (const [key, value] of Object.entries(document)) {
          addDefined(attributes, `${prefix}.document.${key}`, serializeAttribute(value));
        }
        return;
      }
      addDefined(attributes, `${prefix}.document.content`, serializeAttribute(document));
    }
    function resolveUsage(options) {
      return (0, usage_1.normalizeTokenUsage)(options.usage);
    }
    function contractAttributes(options) {
      const attributes = {};
      addDefined(attributes, "input.mime_type", options.inputMimeType);
      addDefined(attributes, "output.mime_type", options.outputMimeType);
      addDefined(attributes, "llm.model_name", options.llmModelName ?? options.model);
      addDefined(attributes, "llm.provider", options.llmProvider);
      addDefined(attributes, "llm.system", options.llmSystem);
      addDefined(attributes, "gen_ai.system", options.llmSystem ?? options.llmProvider);
      Object.assign(attributes, (0, usage_1.tokenUsageAttributes)(resolveUsage(options)));
      addDefined(attributes, "llm.invocation_parameters", serializeAttribute(options.llmInvocationParameters));
      addDefined(attributes, "llm.tools", serializeAttribute(options.llmTools));
      addDefined(attributes, "llm.prompt_template.template", options.llmPromptTemplate);
      addDefined(attributes, "llm.prompt_template.variables", serializeAttribute(options.llmPromptTemplateVariables));
      addDefined(attributes, "llm.prompt_template.version", options.llmPromptTemplateVersion);
      addDefined(attributes, "tool.description", options.toolDescription);
      addDefined(attributes, "tool.parameters", serializeAttribute(options.toolParameters));
      if (options.userFacingMessage !== void 0) {
        attributes["lemma.tool.kind"] = "user_message";
        attributes["lemma.tool.message"] = options.userFacingMessage;
      }
      addDefined(attributes, "embedding.model_name", options.embeddingModelName);
      addDefined(attributes, "embedding.invocation_parameters", serializeAttribute(options.embeddingInvocationParameters));
      addDefined(attributes, "embedding.embeddings", serializeAttribute(options.embeddingEmbeddings));
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
      const error = (0, error_message_1.failureMessage)(options.error);
      const usage = (0, usage_1.toWireTokenUsage)(resolveUsage(options));
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
      if (value == null)
        return void 0;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? void 0 : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? void 0 : parsed;
    }
    var SpanHandle = class {
      trace;
      options;
      ended;
      id;
      payload;
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
      end(options = {}) {
        if (this.ended)
          return;
        this.ended = true;
        Object.assign(this.payload, normalizeSpan({
          ...this.options,
          ...options,
          id: this.id,
          startedAt: this.options.startedAt,
          endedAt: options.endedAt ?? /* @__PURE__ */ new Date()
        }, this.options.type ?? "span"));
        this.trace.spanEnded(this.payload);
        this.trace.changed();
      }
      /**
       * Extend this span's end time if a child finished later.
       * Only applies after end() — open parents are left alone so a later end()
       * cannot overwrite a premature extension with a shorter duration.
       */
      ensureEndedAt(endedAt) {
        if (!this.ended)
          return;
        const nextEnd = timestampMs(endedAt);
        const startedMs = timestampMs(this.payload.started_at);
        if (nextEnd == null || startedMs == null)
          return;
        const currentEnd = timestampMs(this.payload.ended_at) ?? startedMs;
        if (nextEnd <= currentEnd)
          return;
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
    exports.SpanHandle = SpanHandle;
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
    exports.NoopSpanHandle = NoopSpanHandle;
    var TraceContext = class {
      options;
      onChange;
      spans = [];
      traceOutput;
      traceError = null;
      id;
      constructor(options, onChange) {
        this.options = options;
        this.onChange = onChange;
        this.options.name ??= "trace";
        this.options.id ??= crypto.randomUUID();
        this.id = this.options.id;
        this.traceOutput = options.output;
      }
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
        this.traceError = (0, error_message_1.failureMessage)(error);
        this.changed();
      }
      changed() {
        this.onChange?.();
      }
      setChangeHandler(onChange) {
        this.onChange = onChange;
      }
      debugSpan(event, span) {
        (0, debug_mode_1.lemmaDebug)("client", event, {
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
        return new SpanHandle(this, {
          ...options,
          id: spanId,
          startedAt: span.started_at,
          endedAt: span.ended_at
        }, span, true);
      }
      recordGeneration(options) {
        const generationOptions = typeof options === "string" ? { name: options } : options;
        const span = normalizeSpan({ ...generationOptions, type: "generation" }, "generation");
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
        const stamped = (0, usage_1.attachResultUsage)(generations, result);
        if (stamped > 0)
          this.changed();
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
    exports.TraceContext = TraceContext;
    var TraceHandle = class extends TraceContext {
      sendFn;
      sendPromise = Promise.resolve();
      ended = false;
      startedAt;
      constructor(options, sendFn, startedAt) {
        super(options);
        this.sendFn = sendFn;
        this.startedAt = startedAt ?? coerceDate(options.startedAt) ?? /* @__PURE__ */ new Date();
      }
      async end(outputOrOptions) {
        if (this.ended)
          return this.sendPromise;
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
        this.sendPromise = this.sendPromise.then(() => this.sendFn(this, startedAt, endedAt));
        await this.sendPromise;
      }
      /** Whether this trace has already been delivered via `end()`. */
      get isEnded() {
        return this.ended;
      }
    };
    exports.TraceHandle = TraceHandle;
    var Lemma2 = class {
      apiKey;
      projectId;
      baseUrl;
      fetchImpl;
      release;
      traces = /* @__PURE__ */ new Map();
      configLogged = false;
      constructor(options = {}) {
        this.apiKey = required(options.apiKey ?? process.env.LEMMA_API_KEY, "LEMMA_API_KEY");
        this.projectId = required(options.projectId ?? process.env.LEMMA_PROJECT_ID, "LEMMA_PROJECT_ID");
        this.baseUrl = (options.baseUrl ?? "https://api.uselemma.ai").replace(/\/+$/, "");
        this.fetchImpl = options.fetch ?? fetch;
        this.release = (0, release_1.normalizeRelease)(options.release ?? process.env.LEMMA_RELEASE);
        this.logInitConfigOnce();
      }
      /**
       * Run a one-call delivery diagnostic: config check, minimal ingest, and
       * per-trace ingest-status poll (enqueued / ingested / ready).
       */
      async debugSmokeTest() {
        const configWarnings = (0, debug_delivery_1.buildConfigWarnings)(this.baseUrl, this.projectId);
        const hints = [...configWarnings];
        const config = {
          baseUrl: this.baseUrl,
          projectId: this.projectId,
          apiKeySuffix: (0, debug_delivery_1.apiKeySuffix)(this.apiKey),
          ingestPath: debug_delivery_1.INGEST_PATH,
          expectedSuccessStatus: debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS,
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
        const payload = this.stampRelease(context.toPayload(this.projectId, startedAt, /* @__PURE__ */ new Date()));
        const body = JSON.stringify(payload);
        const url = `${this.baseUrl}${debug_delivery_1.INGEST_PATH}`;
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
        const responseHeaders = (0, debug_delivery_1.pickResponseHeaders)(response.headers);
        const ingestWarnings = [];
        if (response.status !== debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS) {
          ingestWarnings.push(`expected status ${debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status}`);
          const hint = (0, debug_delivery_1.ingestFailureHint)(response.status);
          if (hint)
            hints.push(hint);
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
        } else if (!(0, debug_delivery_1.isSuccessfulIngestStatus)(ingestStatus)) {
          hints.push(`ingest returned 201 but ingest-status=not_found after ${debug_delivery_1.INGEST_STATUS_POLL_TIMEOUT_MS / 1e3}s \u2014 may be processing lag or downstream issue`);
        }
        return {
          ok: response.status === debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS && (0, debug_delivery_1.isSuccessfulIngestStatus)(ingestStatus),
          config,
          ingest,
          ingestStatus: ingestStatus ?? void 0,
          hints
        };
      }
      trace(options = {}, fn) {
        const traceOptions = typeof options === "string" ? { name: options } : options;
        if (!fn) {
          const handle = new TraceHandle(traceOptions, async (trace, startedAt2, endedAt) => {
            try {
              await this.flushTrace(trace, startedAt2, endedAt);
            } finally {
              this.traces.delete(trace.id);
            }
          });
          this.traces.set(handle.id, handle);
          (0, debug_mode_1.lemmaDebug)("client", "trace handle created", {
            traceId: handle.id,
            name: traceOptions.name ?? "trace"
          });
          return handle;
        }
        const context = new TraceContext(traceOptions);
        const startedAt = /* @__PURE__ */ new Date();
        (0, debug_mode_1.lemmaDebug)("client", "trace started", {
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
        await this.flushTrace(context, options.startedAt, options.endedAt ?? /* @__PURE__ */ new Date());
      }
      recordSpan(options) {
        const context = this.detachedTraceFor(options.traceId, "span");
        if (!context)
          return new NoopSpanHandle();
        const { traceId: _traceId, parentSpanId, parentId, ...spanOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("span has a parent, but parentSpanId was not provided; skipping span");
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
        if (!context)
          return;
        const { traceId: _traceId, parentSpanId, parentId, ...generationOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("generation has a parent, but parentSpanId was not provided; skipping generation");
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
        if (!context)
          return;
        const { traceId: _traceId, parentSpanId, parentId, ...toolOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("tool has a parent, but parentSpanId was not provided; skipping tool");
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
        if (!context)
          return new NoopSpanHandle();
        const { traceId: _traceId, parentSpanId, parentId, ...spanOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("span has a parent, but parentSpanId was not provided; skipping span");
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
        if (!context)
          return new NoopSpanHandle();
        const { traceId: _traceId, parentSpanId, parentId, ...generationOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("generation has a parent, but parentSpanId was not provided; skipping generation");
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
        if (!context)
          return new NoopSpanHandle();
        const { traceId: _traceId, parentSpanId, parentId, ...toolOptions } = options;
        if (parentId && !parentSpanId) {
          warnNoop("tool has a parent, but parentSpanId was not provided; skipping tool");
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
        if (!(0, debug_mode_1.isDebugModeEnabled)() || this.configLogged)
          return;
        this.configLogged = true;
        const warnings = (0, debug_delivery_1.buildConfigWarnings)(this.baseUrl, this.projectId);
        (0, debug_mode_1.lemmaDebug)("client", "initialized", {
          baseUrl: this.baseUrl,
          projectId: this.projectId,
          apiKey: (0, debug_delivery_1.apiKeySuffix)(this.apiKey),
          ingestPath: debug_delivery_1.INGEST_PATH,
          expectedSuccessStatus: debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS,
          ...warnings.length ? { warnings } : {}
        });
      }
      async fetchIngestStatus(otelTraceId) {
        const url = `${this.baseUrl}${debug_delivery_1.INGEST_STATUS_PATH}?project_id=${encodeURIComponent(this.projectId)}&otel_trace_id=${encodeURIComponent(otelTraceId)}`;
        try {
          const response = await this.fetchImpl(url, {
            headers: { Authorization: `Bearer ${this.apiKey}` }
          });
          if (!response.ok)
            return null;
          const data = await response.json();
          return (0, debug_delivery_1.parseIngestStatus)(data.status);
        } catch {
          return null;
        }
      }
      /**
       * Poll ingest-status immediately, then every 1s until success, hard failure,
       * or the 15s timeout.
       */
      async pollIngestStatus(otelTraceId) {
        const deadline = Date.now() + debug_delivery_1.INGEST_STATUS_POLL_TIMEOUT_MS;
        for (; ; ) {
          const status = await this.fetchIngestStatus(otelTraceId);
          if (status === null)
            return null;
          if ((0, debug_delivery_1.isSuccessfulIngestStatus)(status))
            return status;
          const remaining = deadline - Date.now();
          if (remaining <= 0)
            return status;
          await (0, debug_delivery_1.sleep)(Math.min(debug_delivery_1.INGEST_STATUS_POLL_INTERVAL_MS, remaining));
        }
      }
      async verifyIngestDelivery(otelTraceId) {
        const result = await this.pollIngestStatus(otelTraceId);
        if (result === null) {
          (0, debug_mode_1.lemmaDebug)("verify", "ingest accepted (201), ingest-status check failed (status/network)");
          return;
        }
        if ((0, debug_delivery_1.isSuccessfulIngestStatus)(result)) {
          (0, debug_mode_1.lemmaDebug)("verify", `ingest accepted (201), trace ${result === "enqueued" ? "enqueued" : `visible (${result})`} (status=${result})`);
          return;
        }
        (0, debug_mode_1.lemmaDebug)("verify", `ingest accepted (201), ingest-status=not_found after ${debug_delivery_1.INGEST_STATUS_POLL_TIMEOUT_MS / 1e3}s \u2014 may be processing lag or downstream issue`);
      }
      stampRelease(payload) {
        if (this.release)
          payload.trace.release = this.release;
        return payload;
      }
      async flushTrace(context, startedAt, endedAt) {
        const payload = this.stampRelease(context.toPayload(this.projectId, startedAt, endedAt));
        const body = JSON.stringify(payload);
        const url = `${this.baseUrl}${debug_delivery_1.INGEST_PATH}`;
        (0, debug_mode_1.lemmaDebug)("client", "sending trace", {
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
        const responseHeaders = (0, debug_delivery_1.pickResponseHeaders)(response.headers);
        if (!response.ok) {
          const responseBody = await response.text().catch(() => "");
          const hint = (0, debug_delivery_1.ingestFailureHint)(response.status);
          (0, debug_mode_1.lemmaDebug)("client", "trace ingest failed", {
            traceId: payload.trace.id,
            projectId: payload.project_id,
            status: response.status,
            body: responseBody,
            ...responseHeaders,
            ...hint ? { hint } : {}
          });
          throw new Error(`@uselemma/tracing: failed to ingest trace (${response.status})${responseBody ? `: ${responseBody}` : ""}`);
        }
        const sentWarnings = [];
        if (response.status !== debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS) {
          sentWarnings.push(`expected status ${debug_delivery_1.EXPECTED_INGEST_SUCCESS_STATUS}, got ${response.status} (wrong endpoint?)`);
        }
        (0, debug_mode_1.lemmaDebug)("client", "trace sent", {
          traceId: payload.trace.id,
          projectId: payload.project_id,
          status: response.status,
          ...responseHeaders,
          ...sentWarnings.length ? { warnings: sentWarnings } : {}
        });
        if ((0, debug_mode_1.isDebugModeEnabled)() && (0, debug_mode_1.isDebugVerifyEnabled)() && payload.trace.id) {
          await this.verifyIngestDelivery(payload.trace.id);
        }
      }
    };
    exports.Lemma = Lemma2;
  }
});

// ../../packages/ts/tracing/dist/coding-agent.js
var require_coding_agent = __commonJS({
  "../../packages/ts/tracing/dist/coding-agent.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.startCodingAgentTurn = startCodingAgentTurn2;
    exports.recordCodingAgentToolStart = recordCodingAgentToolStart2;
    exports.recordCodingAgentToolResult = recordCodingAgentToolResult2;
    exports.completeCodingAgentTurn = completeCodingAgentTurn2;
    exports.codingAgentTurnTrace = codingAgentTurnTrace2;
    var node_crypto_1 = __require("node:crypto");
    var client_1 = require_client();
    var error_message_1 = require_error_message();
    function requireOpen(turn) {
      if (turn.status === "completed") {
        throw new Error(`Coding agent turn ${turn.sessionId}/${turn.turnId} already completed`);
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
      const hash = (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
      const variant = (8 + Number.parseInt(hash[16], 16) % 4).toString(16);
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    }
    function turnIdentity(options) {
      return `${options.harness}\0${options.sessionId}\0${options.turnId}`;
    }
    function startCodingAgentTurn2(options) {
      return {
        version: 1,
        status: "open",
        harness: options.harness,
        sessionId: options.sessionId,
        turnId: options.turnId,
        traceId: options.traceId ?? deterministicUuid(`lemma-coding-agent-trace\0${turnIdentity(options)}`),
        generationId: options.generationId ?? deterministicUuid(`lemma-coding-agent-generation\0${turnIdentity(options)}`),
        prompt: options.prompt,
        startedAt: options.startedAt,
        model: options.model,
        provider: options.provider,
        metadata: options.metadata,
        tools: []
      };
    }
    function recordCodingAgentToolStart2(turn, event) {
      const open = requireOpen(turn);
      const existingIndex = open.tools.findIndex((tool) => tool.toolUseId === event.toolUseId);
      if (existingIndex >= 0) {
        const existing = open.tools[existingIndex];
        if (!existing.startTimeMissing)
          return open;
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
    function recordCodingAgentToolResult2(turn, event) {
      const open = requireOpen(turn);
      const existingIndex = open.tools.findIndex((tool) => tool.toolUseId === event.toolUseId);
      const completed = {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input === void 0 && existingIndex >= 0 ? open.tools[existingIndex].input : event.input,
        output: event.output,
        error: (0, error_message_1.failureMessage)(event.error) ?? void 0,
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
    function completeCodingAgentTurn2(turn, event) {
      if (turn.status === "completed")
        return turn;
      if (event.generationStartedAt === void 0 !== (event.generationEndedAt === void 0)) {
        throw new Error("Coding agent generation timing requires both startedAt and endedAt");
      }
      const tools = turn.tools.map((tool) => {
        const error = (0, error_message_1.failureMessage)(tool.error) ?? void 0;
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
    function codingAgentTurnTrace2(turn) {
      const attributes = harnessAttributes(turn);
      const context = new client_1.TraceContext({
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
  }
});

// ../../packages/ts/tracing/dist/schedule.js
var require_schedule = __commonJS({
  "../../packages/ts/tracing/dist/schedule.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.scheduleMacrotask = scheduleMacrotask;
    function scheduleMacrotask(task) {
      if (typeof setImmediate === "function") {
        setImmediate(task);
        return;
      }
      setTimeout(task, 0);
    }
  }
});

// ../../packages/ts/tracing/dist/tool-result.js
var require_tool_result = __commonJS({
  "../../packages/ts/tracing/dist/tool-result.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.toolResultError = toolResultError;
    function toolResultError(output) {
      const record = asResultRecord(output);
      if (!record)
        return null;
      if (record.isError !== true && record.is_error !== true && record.error !== true) {
        return null;
      }
      const content = record.content;
      if (Array.isArray(content)) {
        const text = content.map((part) => {
          if (!part || typeof part !== "object")
            return "";
          const textValue = part.text;
          return typeof textValue === "string" ? textValue : "";
        }).filter(Boolean).join("\n").trim();
        if (text)
          return text;
      }
      if (typeof record.error === "string" && record.error.trim()) {
        return record.error;
      }
      if (typeof record.message === "string" && record.message.trim()) {
        return record.message;
      }
      try {
        return JSON.stringify(record);
      } catch {
        return "Tool returned an error result";
      }
    }
    function asResultRecord(output) {
      if (output == null)
        return null;
      if (typeof output === "string") {
        const trimmed = output.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
          return null;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
          return null;
        } catch {
          return null;
        }
      }
      if (typeof output === "object" && !Array.isArray(output)) {
        return output;
      }
      return null;
    }
  }
});

// ../../packages/ts/tracing/dist/langchain.js
var require_langchain = __commonJS({
  "../../packages/ts/tracing/dist/langchain.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LangChainCallbackHandler = exports.LemmaLangChainCallbackHandler = void 0;
    exports.langChain = langChain;
    exports.langGraph = langGraph;
    var client_1 = require_client();
    var error_message_1 = require_error_message();
    var schedule_1 = require_schedule();
    var tool_result_1 = require_tool_result();
    var usage_1 = require_usage();
    var INTEGRATION_ATTRS = {
      "lemma.sdk.integration": "langchain"
    };
    var KNOWN_PROVIDERS = [
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
      "perplexity"
    ];
    var CLASS_PROVIDER_HINTS = [
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
      [/perplexity/i, "perplexity"]
    ];
    function serializedName(serialized, fallback) {
      if (typeof serialized?.name === "string" && serialized.name) {
        return serialized.name;
      }
      const id = serialized?.id;
      if (Array.isArray(id) && id.length > 0) {
        return String(id[id.length - 1]);
      }
      return fallback;
    }
    function modelName(serialized, extraParams) {
      const kwargs = serialized?.kwargs;
      const sources = [kwargs, serialized, extraParams];
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of [
          "model",
          "modelName",
          "model_name",
          "model_id",
          "modelId"
        ]) {
          const value = source[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return void 0;
    }
    function lookupString(sources, keys) {
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of keys) {
          const value = source[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return void 0;
    }
    function tagValue(tags, keys) {
      if (!tags?.length)
        return void 0;
      for (const key of keys) {
        const prefix = `${key}:`;
        for (const tag of tags) {
          if (typeof tag !== "string")
            continue;
          if (tag.startsWith(prefix)) {
            const value = tag.slice(prefix.length).trim();
            if (value)
              return value;
          }
          if (tag.startsWith(`${key}=`)) {
            const value = tag.slice(key.length + 1).trim();
            if (value)
              return value;
          }
        }
      }
      return void 0;
    }
    function messageContent(message) {
      if (!message || typeof message !== "object")
        return message;
      const record = message;
      if ("content" in record)
        return record.content;
      return message;
    }
    function messageRole(message) {
      if (!message || typeof message !== "object")
        return void 0;
      const record = message;
      if (typeof record.role === "string" && record.role)
        return record.role;
      const type = typeof record.type === "string" && record.type || typeof record._type === "string" && record._type || (typeof record.getType === "function" ? record.getType() : void 0);
      if (!type) {
        const id = record.id;
        if (Array.isArray(id) && id.length > 0) {
          return roleFromClassName(String(id[id.length - 1]));
        }
        const name = typeof record.name === "string" ? record.name : typeof record.constructor === "function" && typeof record.constructor.name === "string" ? record.constructor.name : void 0;
        return name ? roleFromClassName(name) : void 0;
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
    function roleFromClassName(name) {
      const lower = name.toLowerCase();
      if (lower.includes("human") || lower === "user")
        return "user";
      if (lower.includes("ai") || lower.includes("assistant"))
        return "assistant";
      if (lower.includes("system"))
        return "system";
      if (lower.includes("tool"))
        return "tool";
      if (lower.includes("function"))
        return "function";
      if (lower.includes("chat") && lower.includes("message"))
        return void 0;
      return void 0;
    }
    function toolCallsFromMessage(record) {
      if (Array.isArray(record.tool_calls) && record.tool_calls.length) {
        return record.tool_calls;
      }
      if (Array.isArray(record.toolCalls) && record.toolCalls.length) {
        return record.toolCalls;
      }
      const additional = record.additional_kwargs;
      if (additional && typeof additional === "object") {
        const calls = additional.tool_calls;
        if (Array.isArray(calls) && calls.length)
          return calls;
      }
      const kwargs = record.kwargs;
      if (kwargs && typeof kwargs === "object") {
        const calls = kwargs.tool_calls;
        if (Array.isArray(calls) && calls.length)
          return calls;
      }
      return void 0;
    }
    function normalizeMessage(message) {
      if (typeof message === "string") {
        return { role: "user", content: message };
      }
      if (!message || typeof message !== "object") {
        return { role: "user", content: message };
      }
      const record = message;
      const kwargs = record.kwargs && typeof record.kwargs === "object" ? record.kwargs : void 0;
      const content = "content" in record ? record.content : kwargs && "content" in kwargs ? kwargs.content : messageContent(message);
      const role = messageRole(message) ?? messageRole(kwargs) ?? "user";
      const normalized = {
        role,
        content
      };
      const toolCalls = toolCallsFromMessage(record) ?? (kwargs ? toolCallsFromMessage(kwargs) : void 0);
      if (toolCalls)
        normalized.tool_calls = toolCalls;
      const toolCallId = typeof record.tool_call_id === "string" && record.tool_call_id || typeof record.toolCallId === "string" && record.toolCallId || (kwargs && typeof kwargs.tool_call_id === "string" ? kwargs.tool_call_id : void 0);
      if (toolCallId)
        normalized.tool_call_id = toolCallId;
      const name = typeof record.name === "string" && record.name || (kwargs && typeof kwargs.name === "string" ? kwargs.name : void 0);
      if (name && (role === "tool" || role === "function")) {
        normalized.name = name;
      }
      return normalized;
    }
    function normalizeMessages(messages) {
      return messages.map(normalizeMessage);
    }
    function asMessageList(input) {
      if (Array.isArray(input))
        return input;
      if (input && typeof input === "object") {
        const record = input;
        if (Array.isArray(record.messages))
          return record.messages;
        if (Array.isArray(record.input))
          return record.input;
      }
      return void 0;
    }
    function rootTraceInput(input) {
      if (typeof input === "string")
        return input;
      const messages = asMessageList(input);
      if (messages && messages.length > 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const normalized = normalizeMessage(messages[i]);
          if (normalized.role === "user")
            return normalized.content;
        }
        return normalizeMessage(messages[messages.length - 1]).content;
      }
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const record = input;
        for (const key of [
          "input",
          "question",
          "query",
          "prompt",
          "text",
          "user_input",
          "userInput"
        ]) {
          const value = record[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return input;
    }
    function rootTraceOutput(output) {
      if (output == null)
        return output;
      if (typeof output === "string")
        return output;
      if (output && typeof output === "object" && !Array.isArray(output)) {
        const record = output;
        if (record.role === "assistant" && (record.tool_calls != null || record.toolCalls != null)) {
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
        return structuredAssistantOutput(normalizeMessage(messages[messages.length - 1]));
      }
      if (output && typeof output === "object" && !Array.isArray(output)) {
        const record = output;
        for (const key of ["output", "answer", "result", "text", "content"]) {
          const value = record[key];
          if (typeof value === "string" && value)
            return value;
          if (value && typeof value === "object") {
            const nested = value;
            if (typeof nested.content === "string")
              return nested.content;
          }
        }
      }
      return output;
    }
    function structuredAssistantOutput(message) {
      if (message.tool_calls) {
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls
        };
      }
      return message.content;
    }
    function firstText(value) {
      if (typeof value === "string")
        return value;
      if (!value || typeof value !== "object")
        return void 0;
      const record = value;
      if (typeof record.text === "string")
        return record.text;
      if (typeof record.content === "string")
        return record.content;
      const message = record.message;
      if (message && typeof message === "object") {
        return firstText(message);
      }
      return void 0;
    }
    function generationMessage(item) {
      if (!item || typeof item !== "object")
        return void 0;
      const record = item;
      if (record.message != null)
        return record.message;
      if (typeof record.role === "string" || typeof record.type === "string" || typeof record._type === "string") {
        return record;
      }
      if ("content" in record && typeof record.text !== "string")
        return record;
      return void 0;
    }
    function llmStructuredOutput(result) {
      const generations = result.generations;
      if (!Array.isArray(generations))
        return result;
      const messages = [];
      for (const group of generations) {
        if (!Array.isArray(group))
          continue;
        for (const item of group) {
          const message = generationMessage(item);
          if (message != null) {
            messages.push(normalizeMessage(message));
            continue;
          }
          const text2 = firstText(item);
          if (text2 != null) {
            messages.push({ role: "assistant", content: text2 });
          }
        }
      }
      if (messages.length === 1) {
        return structuredAssistantOutput(messages[0]);
      }
      if (messages.length > 1)
        return messages;
      const text = generations.flat().map(firstText).filter(Boolean).join("");
      return text || generations;
    }
    function llmOutputMessages(result) {
      const generations = result.generations;
      if (!Array.isArray(generations))
        return void 0;
      const messages = [];
      for (const group of generations) {
        if (!Array.isArray(group))
          continue;
        for (const item of group) {
          const message = generationMessage(item);
          if (message != null) {
            messages.push(normalizeMessage(message));
            continue;
          }
          const text = firstText(item);
          if (text != null)
            messages.push({ role: "assistant", content: text });
        }
      }
      return messages.length ? messages : void 0;
    }
    function hasToolCalls(output) {
      if (!output || typeof output !== "object")
        return false;
      if (Array.isArray(output))
        return output.some((item) => hasToolCalls(item));
      const record = output;
      if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
        return true;
      }
      if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) {
        return true;
      }
      return false;
    }
    function providerFromId(id) {
      if (!Array.isArray(id))
        return void 0;
      for (const part of id) {
        if (typeof part !== "string")
          continue;
        const lower = part.toLowerCase().replace(/-/g, "_");
        for (const provider of KNOWN_PROVIDERS) {
          if (lower === provider || lower.includes(provider)) {
            if (provider === "azure_openai")
              return "azure";
            if (provider === "google_genai" || provider === "google_vertexai") {
              return "google";
            }
            if (provider === "amazon_bedrock")
              return "bedrock";
            if (provider === "mistralai")
              return "mistral";
            if (provider === "huggingface_hub")
              return "huggingface";
            return provider;
          }
        }
        const pkg = lower.match(/^langchain[_]?([a-z0-9]+)/);
        if (pkg?.[1] && pkg[1] !== "core" && pkg[1] !== "community") {
          return providerFromClassName(pkg[1]) ?? pkg[1];
        }
      }
      return void 0;
    }
    function providerFromClassName(name) {
      for (const [pattern, provider] of CLASS_PROVIDER_HINTS) {
        if (pattern.test(name))
          return provider;
      }
      return void 0;
    }
    function llmProvider(serialized, extraParams) {
      const kwargs = serialized?.kwargs;
      const sources = [kwargs, serialized, extraParams];
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of [
          "provider",
          "ls_provider",
          "llm_provider",
          "llmProvider"
        ]) {
          const value = source[key];
          if (typeof value === "string" && value && value !== "langchain") {
            return value;
          }
        }
      }
      const fromId = providerFromId(serialized?.id);
      if (fromId)
        return fromId;
      const className = serializedName(serialized, "");
      const fromClass = className ? providerFromClassName(className) : void 0;
      if (fromClass)
        return fromClass;
      const type = typeof extraParams?._type === "string" && extraParams._type || typeof kwargs?._type === "string" && kwargs._type;
      if (type) {
        const fromType = providerFromClassName(type);
        if (fromType)
          return fromType;
      }
      return void 0;
    }
    function durationMs(start, end) {
      return Math.max(0, end.getTime() - start.getTime());
    }
    function langchainAttributes(runId, parentRunId, runType) {
      return Object.fromEntries(Object.entries({
        ...INTEGRATION_ATTRS,
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": runType
      }).filter(([, value]) => value !== void 0 && value !== null));
    }
    function llmTokenUsage(result) {
      const llmOutput = result.llmOutput;
      if (llmOutput && typeof llmOutput === "object") {
        const fromOutput = (0, usage_1.normalizeTokenUsage)(llmOutput);
        if (fromOutput)
          return fromOutput;
      }
      const generations = result.generations;
      if (!Array.isArray(generations))
        return void 0;
      for (const group of generations) {
        if (!Array.isArray(group))
          continue;
        for (const item of group) {
          if (!item || typeof item !== "object")
            continue;
          const record = item;
          const message = record.message;
          if (message && typeof message === "object") {
            const msg = message;
            const fromMessage = (0, usage_1.normalizeTokenUsage)(msg.usage_metadata) ?? (0, usage_1.normalizeTokenUsage)(msg.usageMetadata) ?? (0, usage_1.normalizeTokenUsage)(msg.response_metadata) ?? (0, usage_1.normalizeTokenUsage)(msg);
            if (fromMessage)
              return fromMessage;
          }
          const fromItem = (0, usage_1.normalizeTokenUsage)(record.usage_metadata) ?? (0, usage_1.normalizeTokenUsage)(record.generationInfo) ?? (0, usage_1.normalizeTokenUsage)(record);
          if (fromItem)
            return fromItem;
        }
      }
      return void 0;
    }
    var LemmaLangChainCallbackHandler = class {
      options;
      name = "lemma";
      lemma;
      runs = /* @__PURE__ */ new Map();
      traces = /* @__PURE__ */ new Map();
      pending = /* @__PURE__ */ new Set();
      constructor(options = {}) {
        this.options = options;
        this.lemma = options.lemma;
      }
      getLemma() {
        this.lemma ??= new client_1.Lemma({
          apiKey: this.options.apiKey,
          projectId: this.options.projectId,
          baseUrl: this.options.baseUrl,
          fetch: this.options.fetch,
          release: this.options.release
        });
        return this.lemma;
      }
      resolveThreadId(metadata, tags) {
        const key = this.options.threadIdKey ?? "threadId";
        const keys = [key, "threadId", "thread_id", "conversation_id", "session_id"];
        return lookupString([metadata, this.options.metadata], keys) ?? tagValue(tags, keys);
      }
      resolveUserId(metadata, tags) {
        if (this.options.userIdKey) {
          return lookupString([metadata, this.options.metadata], [this.options.userIdKey]) ?? tagValue(tags, [this.options.userIdKey]);
        }
        const keys = ["userId", "user_id", "resourceId"];
        return lookupString([metadata, this.options.metadata], keys) ?? tagValue(tags, keys);
      }
      applyIdentity(stored, metadata, tags) {
        const threadId = this.resolveThreadId(metadata, tags);
        const userId = this.resolveUserId(metadata, tags);
        if (threadId)
          stored.handle.threadId(threadId);
        if (userId)
          stored.handle.userId(userId);
      }
      noteBounds(stored, start, end) {
        if (start) {
          stored.earliestStart = !stored.earliestStart || start < stored.earliestStart ? start : stored.earliestStart;
        }
        if (end) {
          stored.latestEnd = !stored.latestEnd || end > stored.latestEnd ? end : stored.latestEnd;
        }
      }
      noteRootInput(stored, input) {
        if (input == null || stored.hasRootInput)
          return;
        stored.rootInput = rootTraceInput(input);
        stored.hasRootInput = true;
        stored.handle.input(stored.rootInput);
      }
      noteRootOutput(stored, output) {
        if (output == null || stored.rootError)
          return;
        stored.rootOutput = rootTraceOutput(output);
      }
      noteRootError(stored, error) {
        if (!error || stored.rootError)
          return;
        stored.rootError = error;
      }
      trackPending(promise) {
        this.pending.add(promise);
        void promise.finally(() => this.pending.delete(promise));
      }
      createOwnedTrace(runId, name, input, kind, metadata, tags) {
        const startedAt = /* @__PURE__ */ new Date();
        const handle = this.getLemma().trace({
          name,
          input: rootTraceInput(input),
          metadata: {
            ...this.options.metadata,
            ...metadata ?? {},
            langchainRunId: runId
          },
          threadId: this.resolveThreadId(metadata, tags),
          userId: this.resolveUserId(metadata, tags),
          startedAt
        });
        const stored = {
          handle,
          ended: false,
          openedAt: startedAt,
          earliestStart: startedAt,
          hasRootInput: input != null,
          rootInput: rootTraceInput(input)
        };
        this.traces.set(runId, stored);
        const run = {
          owningTraceId: runId,
          rootRunId: runId,
          kind,
          startedAt,
          ownsTrace: true
        };
        this.runs.set(runId, run);
        return { stored, run };
      }
      storedTrace(owningTraceId) {
        return this.traces.get(owningTraceId);
      }
      parentRun(parentRunId) {
        if (!parentRunId)
          return void 0;
        return this.runs.get(parentRunId);
      }
      /**
       * Resolve the parent attachment target.
       * - Known parent → attach under that parent's owning trace.
       * - Missing / unknown parent → create a NEW owned trace for this run
       *   (never overwrite another concurrent trace's state).
       */
      resolveAttachment(runId, parentRunId, createRoot) {
        const parent = this.parentRun(parentRunId);
        if (!parent) {
          const created = createRoot();
          return {
            stored: created.stored,
            parentId: void 0,
            ownsTrace: true,
            owningTraceId: runId,
            rootRunId: runId
          };
        }
        const stored = this.storedTrace(parent.owningTraceId);
        if (!stored || stored.ended) {
          const created = createRoot();
          return {
            stored: created.stored,
            parentId: void 0,
            ownsTrace: true,
            owningTraceId: runId,
            rootRunId: runId
          };
        }
        return {
          stored,
          parentId: parent.handle?.id,
          ownsTrace: false,
          owningTraceId: parent.owningTraceId,
          rootRunId: parent.rootRunId
        };
      }
      forgetTraceRuns(owningTraceId) {
        for (const [runId, run] of this.runs) {
          if (run.owningTraceId === owningTraceId)
            this.runs.delete(runId);
        }
      }
      async finalizeTrace(owningTraceId, stored) {
        this.traces.delete(owningTraceId);
        this.forgetTraceRuns(owningTraceId);
        if (stored.ended)
          return;
        stored.ended = true;
        const endedAt = stored.latestEnd ?? /* @__PURE__ */ new Date();
        const startedAt = stored.earliestStart ?? stored.openedAt ?? endedAt;
        const timing = {
          startedAt,
          endedAt,
          durationMs: durationMs(startedAt, endedAt)
        };
        if (stored.rootError) {
          stored.handle.fail(stored.rootError);
          const promise2 = stored.handle.end(timing);
          this.trackPending(promise2);
          await promise2;
          return;
        }
        if (stored.rootOutput === void 0) {
          const promise2 = stored.handle.end(timing);
          this.trackPending(promise2);
          await promise2;
          return;
        }
        const promise = stored.handle.end({
          output: stored.rootOutput,
          ...timing
        });
        this.trackPending(promise);
        await promise;
      }
      maybeFinalizeOwner(run, endedAt) {
        if (!run.ownsTrace)
          return;
        const stored = this.traces.get(run.owningTraceId);
        if (!stored || stored.ended)
          return;
        this.noteBounds(stored, run.startedAt, endedAt);
        const promise = new Promise((resolve2, reject) => {
          (0, schedule_1.scheduleMacrotask)(() => {
            this.finalizeTrace(run.owningTraceId, stored).then(resolve2, reject);
          });
        });
        this.trackPending(promise);
        return promise;
      }
      /**
       * Copy token usage from an `invoke` / chain result onto generation spans
       * whose callback event omitted it. Call after the operation returns.
       */
      recordResult(result) {
        let stamped = 0;
        for (const stored of this.traces.values()) {
          if (stored.ended)
            continue;
          stamped += stored.handle.applyGenerationUsage(result);
        }
        return stamped;
      }
      traceName(serialized, fallback) {
        return this.options.agentName ?? serializedName(serialized, fallback);
      }
      handleChainStart(serialized, inputs, runId, parentRunId, tags, metadata, runType, name) {
        const startedAt = /* @__PURE__ */ new Date();
        const chainName = name ?? serializedName(serialized, "langchain-chain");
        const parent = this.parentRun(parentRunId);
        if (!parent) {
          this.createOwnedTrace(runId, this.traceName({ ...serialized, name: name ?? serialized?.name }, "langchain-run"), inputs, "chain", metadata, tags);
          return;
        }
        const stored = this.storedTrace(parent.owningTraceId);
        if (!stored || stored.ended) {
          this.createOwnedTrace(runId, this.traceName({ ...serialized, name: name ?? serialized?.name }, "langchain-run"), inputs, "chain", metadata, tags);
          return;
        }
        this.applyIdentity(stored, metadata, tags);
        this.noteBounds(stored, startedAt, void 0);
        const handle = stored.handle.startSpan({
          name: chainName,
          parentId: parent.handle?.id,
          input: inputs,
          metadata: this.options.metadata,
          attributes: langchainAttributes(runId, parentRunId, runType || "chain"),
          startedAt
        });
        this.runs.set(runId, {
          owningTraceId: parent.owningTraceId,
          rootRunId: parent.rootRunId,
          handle,
          kind: "chain",
          startedAt,
          parentRunId,
          ownsTrace: false
        });
      }
      async handleChainEnd(outputs, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const stored = this.storedTrace(run.owningTraceId);
        if (run.handle) {
          run.handle.end({
            output: outputs,
            endedAt,
            durationMs: durationMs(run.startedAt, endedAt)
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
      async handleChainError(error, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const message = (0, error_message_1.describeError)(error);
        const stored = this.storedTrace(run.owningTraceId);
        if (run.handle) {
          run.handle.end({
            status: "ERROR",
            error: message,
            endedAt,
            durationMs: durationMs(run.startedAt, endedAt)
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
      handleLLMStart(serialized, prompts, runId, parentRunId, extraParams, tags, metadata) {
        const startedAt = /* @__PURE__ */ new Date();
        const attachment = this.resolveAttachment(runId, parentRunId, () => this.createOwnedTrace(runId, this.traceName(serialized, "langchain-llm"), prompts, "llm", metadata, tags));
        if (attachment.ownsTrace) {
          this.noteRootInput(attachment.stored, prompts);
        }
        this.applyIdentity(attachment.stored, metadata, tags);
        this.noteBounds(attachment.stored, startedAt, void 0);
        const provider = llmProvider(serialized, extraParams);
        const model = modelName(serialized, extraParams);
        const handle = attachment.stored.handle.startGeneration({
          name: serializedName(serialized, "langchain-llm"),
          parentId: attachment.parentId,
          input: prompts,
          metadata: this.options.metadata,
          model,
          llmProvider: provider,
          llmInputMessages: prompts.map((content) => ({ role: "user", content })),
          llmInvocationParameters: extraParams,
          attributes: langchainAttributes(runId, parentRunId, "llm"),
          startedAt
        });
        this.runs.set(runId, {
          owningTraceId: attachment.owningTraceId,
          rootRunId: attachment.rootRunId,
          handle,
          kind: "llm",
          startedAt,
          parentRunId,
          ownsTrace: attachment.ownsTrace
        });
      }
      handleChatModelStart(serialized, messages, runId, parentRunId, extraParams, tags, metadata) {
        const startedAt = /* @__PURE__ */ new Date();
        const flatMessages = messages.flat();
        const normalized = normalizeMessages(flatMessages);
        const attachment = this.resolveAttachment(runId, parentRunId, () => this.createOwnedTrace(runId, this.traceName(serialized, "langchain-chat-model"), flatMessages, "llm", metadata, tags));
        if (attachment.ownsTrace) {
          this.noteRootInput(attachment.stored, flatMessages);
        }
        this.applyIdentity(attachment.stored, metadata, tags);
        this.noteBounds(attachment.stored, startedAt, void 0);
        const provider = llmProvider(serialized, extraParams);
        const model = modelName(serialized, extraParams);
        const handle = attachment.stored.handle.startGeneration({
          name: serializedName(serialized, "langchain-chat-model"),
          parentId: attachment.parentId,
          input: normalized,
          metadata: this.options.metadata,
          model,
          llmProvider: provider,
          llmInputMessages: normalized,
          llmInvocationParameters: extraParams,
          attributes: langchainAttributes(runId, parentRunId, "llm"),
          startedAt
        });
        this.runs.set(runId, {
          owningTraceId: attachment.owningTraceId,
          rootRunId: attachment.rootRunId,
          handle,
          kind: "llm",
          startedAt,
          parentRunId,
          ownsTrace: attachment.ownsTrace
        });
      }
      deferredOwnerFor(owningTraceId) {
        for (const run of this.runs.values()) {
          if (run.ownsTrace && run.deferFinalize && run.owningTraceId === owningTraceId) {
            return run;
          }
        }
        return void 0;
      }
      async handleLLMEnd(output, runId) {
        const run = this.runs.get(runId);
        if (!run?.handle)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const structured = llmStructuredOutput(output);
        const outputMessages = llmOutputMessages(output);
        const softError = (0, tool_result_1.toolResultError)(structured);
        const awaitingTools = !softError && hasToolCalls(structured);
        run.handle.end({
          output: softError ? void 0 : structured,
          error: softError ?? void 0,
          status: softError ? "ERROR" : void 0,
          endedAt,
          durationMs: durationMs(run.startedAt, endedAt),
          llmOutputMessages: softError ? void 0 : outputMessages,
          usage: llmTokenUsage(output)
        });
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace) {
            if (softError)
              this.noteRootError(stored, softError);
            else
              this.noteRootOutput(stored, structured);
          } else if (!softError) {
            this.noteRootOutput(stored, structured);
          }
        }
        if (awaitingTools) {
          if (run.ownsTrace)
            run.deferFinalize = true;
          return;
        }
        this.runs.delete(runId);
        if (run.ownsTrace) {
          void this.maybeFinalizeOwner(run, endedAt);
          return;
        }
        const deferred = this.deferredOwnerFor(run.owningTraceId);
        if (deferred) {
          this.runs.delete(deferred.rootRunId);
          void this.maybeFinalizeOwner(deferred, endedAt);
        }
      }
      async finalizeDeferredOwner(owningTraceId, endedAt, rootError) {
        const deferred = this.deferredOwnerFor(owningTraceId);
        if (!deferred)
          return;
        const stored = this.storedTrace(deferred.owningTraceId);
        if (stored && rootError)
          this.noteRootError(stored, rootError);
        this.runs.delete(deferred.rootRunId);
        void this.maybeFinalizeOwner(deferred, endedAt);
      }
      async handleLLMError(error, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const message = (0, error_message_1.describeError)(error);
        run.handle?.end({
          status: "ERROR",
          error: message,
          endedAt,
          durationMs: durationMs(run.startedAt, endedAt)
        });
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace)
            this.noteRootError(stored, message);
        }
        this.runs.delete(runId);
        if (run.ownsTrace) {
          void this.maybeFinalizeOwner(run, endedAt);
          return;
        }
        void this.finalizeDeferredOwner(run.owningTraceId, endedAt, message);
      }
      handleToolStart(serialized, input, runId, parentRunId, tags, metadata) {
        const startedAt = /* @__PURE__ */ new Date();
        const attachment = this.resolveAttachment(runId, parentRunId, () => this.createOwnedTrace(runId, this.traceName(serialized, "langchain-tool"), input, "tool", metadata, tags));
        if (attachment.ownsTrace) {
          this.noteRootInput(attachment.stored, input);
        }
        this.applyIdentity(attachment.stored, metadata, tags);
        this.noteBounds(attachment.stored, startedAt, void 0);
        const name = serializedName(serialized, "langchain-tool");
        const handle = attachment.stored.handle.startTool({
          name,
          parentId: attachment.parentId,
          toolName: name,
          input,
          metadata: this.options.metadata,
          attributes: langchainAttributes(runId, parentRunId, "tool"),
          startedAt
        });
        this.runs.set(runId, {
          owningTraceId: attachment.owningTraceId,
          rootRunId: attachment.rootRunId,
          handle,
          kind: "tool",
          startedAt,
          parentRunId,
          ownsTrace: attachment.ownsTrace
        });
      }
      async handleToolEnd(output, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const softError = (0, tool_result_1.toolResultError)(output);
        if (softError) {
          run.handle?.end({
            status: "ERROR",
            error: softError,
            endedAt,
            durationMs: durationMs(run.startedAt, endedAt)
          });
        } else {
          run.handle?.end({
            output,
            endedAt,
            durationMs: durationMs(run.startedAt, endedAt)
          });
        }
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace) {
            if (softError)
              this.noteRootError(stored, softError);
            else
              this.noteRootOutput(stored, output);
          }
        }
        this.runs.delete(runId);
        void this.maybeFinalizeOwner(run, endedAt);
      }
      async handleToolError(error, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const message = (0, error_message_1.describeError)(error);
        run.handle?.end({
          status: "ERROR",
          error: message,
          endedAt,
          durationMs: durationMs(run.startedAt, endedAt)
        });
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace)
            this.noteRootError(stored, message);
        }
        this.runs.delete(runId);
        if (run.ownsTrace) {
          void this.maybeFinalizeOwner(run, endedAt);
          return;
        }
        void this.finalizeDeferredOwner(run.owningTraceId, endedAt, message);
      }
      handleRetrieverStart(serialized, query, runId, parentRunId, tags, metadata) {
        const startedAt = /* @__PURE__ */ new Date();
        const attachment = this.resolveAttachment(runId, parentRunId, () => this.createOwnedTrace(runId, this.traceName(serialized, "langchain-retriever"), query, "retriever", metadata, tags));
        if (attachment.ownsTrace) {
          this.noteRootInput(attachment.stored, query);
        }
        this.applyIdentity(attachment.stored, metadata, tags);
        this.noteBounds(attachment.stored, startedAt, void 0);
        const handle = attachment.stored.handle.startSpan({
          name: serializedName(serialized, "langchain-retriever"),
          parentId: attachment.parentId,
          input: query,
          metadata: this.options.metadata,
          attributes: langchainAttributes(runId, parentRunId, "retriever"),
          startedAt
        });
        this.runs.set(runId, {
          owningTraceId: attachment.owningTraceId,
          rootRunId: attachment.rootRunId,
          handle,
          kind: "retriever",
          startedAt,
          parentRunId,
          ownsTrace: attachment.ownsTrace
        });
      }
      async handleRetrieverEnd(documents, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        run.handle?.end({
          output: documents,
          endedAt,
          durationMs: durationMs(run.startedAt, endedAt)
        });
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace)
            this.noteRootOutput(stored, documents);
        }
        this.runs.delete(runId);
        void this.maybeFinalizeOwner(run, endedAt);
      }
      async handleRetrieverError(error, runId) {
        const run = this.runs.get(runId);
        if (!run)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const message = (0, error_message_1.describeError)(error);
        run.handle?.end({
          status: "ERROR",
          error: message,
          endedAt,
          durationMs: durationMs(run.startedAt, endedAt)
        });
        const stored = this.storedTrace(run.owningTraceId);
        if (stored) {
          this.noteBounds(stored, run.startedAt, endedAt);
          if (run.ownsTrace)
            this.noteRootError(stored, message);
        }
        this.runs.delete(runId);
        void this.maybeFinalizeOwner(run, endedAt);
      }
      /** Send completed traces and await ingest delivery. */
      async flush() {
        await Promise.all([
          ...Array.from(this.traces.entries(), ([id, stored]) => this.finalizeTrace(id, stored)),
          ...Array.from(this.pending)
        ]);
      }
      /** Finalize open traces and reset integration state. */
      async shutdown() {
        await this.flush();
        this.runs.clear();
        this.traces.clear();
      }
    };
    exports.LemmaLangChainCallbackHandler = LemmaLangChainCallbackHandler;
    exports.LangChainCallbackHandler = LemmaLangChainCallbackHandler;
    function langChain(options = {}) {
      return new LemmaLangChainCallbackHandler(options);
    }
    function langGraph(options = {}) {
      return langChain({ agentName: "langgraph-agent", ...options });
    }
  }
});

// ../../packages/ts/tracing/dist/mastra.js
var require_mastra = __commonJS({
  "../../packages/ts/tracing/dist/mastra.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.LemmaMastraExporter = void 0;
    exports.mastra = mastra;
    var client_1 = require_client();
    var error_message_1 = require_error_message();
    var schedule_1 = require_schedule();
    var tool_result_1 = require_tool_result();
    var usage_1 = require_usage();
    var INTEGRATION_ATTRS = {
      "lemma.sdk.integration": "mastra"
    };
    var GENERATION_TYPES = /* @__PURE__ */ new Set(["model_generation", "model_step"]);
    var TOOL_TYPES = /* @__PURE__ */ new Set([
      "tool_call",
      "mcp_tool_call",
      "client_tool_call",
      "provider_tool_call"
    ]);
    function toDate(value) {
      if (value == null)
        return void 0;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? void 0 : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? void 0 : parsed;
    }
    function durationMs(start, end) {
      const startedAt = toDate(start);
      const endedAt = toDate(end);
      if (!startedAt || !endedAt)
        return void 0;
      return Math.max(0, endedAt.getTime() - startedAt.getTime());
    }
    function lookupString(sources, keys) {
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of keys) {
          const value = source[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return void 0;
    }
    function attributeString(attributes, key) {
      const value = attributes?.[key];
      return typeof value === "string" && value ? value : void 0;
    }
    function asOutputMessages(output) {
      if (output == null)
        return void 0;
      if (Array.isArray(output))
        return output;
      if (typeof output === "object") {
        const record = output;
        if (typeof record.role === "string")
          return [output];
        if (typeof record.text === "string") {
          return [{ role: "assistant", content: record.text }];
        }
      }
      return [{ role: "assistant", content: output }];
    }
    function asInputMessages(input) {
      if (Array.isArray(input))
        return input;
      if (input && typeof input === "object") {
        const messages = input.messages;
        if (Array.isArray(messages))
          return messages;
      }
      return void 0;
    }
    function toolNameFromSpanName(name) {
      const match = /^tool:\s*['"]([^'"]+)['"]\s*$/i.exec(name.trim());
      return match?.[1] || void 0;
    }
    function resolveToolName(span) {
      if (typeof span.entityId === "string" && span.entityId)
        return span.entityId;
      if (typeof span.entityName === "string" && span.entityName) {
        return span.entityName;
      }
      return toolNameFromSpanName(span.name) ?? span.name;
    }
    function agentNameFromSpanName(name) {
      const match = /^(?:agent|workflow)\s+run:\s*['"]([^'"]+)['"]\s*$/i.exec(name.trim());
      return match?.[1] || void 0;
    }
    function resolveAgentName(span) {
      if (typeof span.entityId === "string" && span.entityId)
        return span.entityId;
      if (typeof span.entityName === "string" && span.entityName) {
        return span.entityName;
      }
      return agentNameFromSpanName(span.name) ?? span.name;
    }
    function messageContent(message) {
      if (!message || typeof message !== "object")
        return message;
      const record = message;
      if ("content" in record)
        return record.content;
      return message;
    }
    function rootTraceInput(input) {
      if (typeof input === "string")
        return input;
      const messages = asInputMessages(input);
      if (!messages || messages.length === 0)
        return input;
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message || typeof message !== "object")
          continue;
        const role = message.role;
        if (role === "user")
          return messageContent(message);
      }
      return messageContent(messages[messages.length - 1]);
    }
    function resolveParentId(parentSpanId, rootSpanId, recordedIds) {
      if (!parentSpanId || parentSpanId === rootSpanId)
        return void 0;
      if (!recordedIds.has(parentSpanId))
        return void 0;
      return parentSpanId;
    }
    function softFailureMessage(output) {
      if (!output || typeof output !== "object" || Array.isArray(output)) {
        return void 0;
      }
      const record = output;
      if (typeof record.message === "string" && record.message.trim()) {
        return record.message;
      }
      if (typeof record.error === "string" && record.error.trim()) {
        return record.error;
      }
      return void 0;
    }
    function errorInfoMessage(errorInfo) {
      if (!errorInfo)
        return void 0;
      if (errorInfo.message?.trim())
        return (0, error_message_1.describeError)(errorInfo.message);
      const label = trimmed(errorInfo.category) ?? trimmed(errorInfo.domain) ?? trimmed(errorInfo.id);
      return label ? `${label} error (no message)` : (0, error_message_1.describeError)(errorInfo);
    }
    function trimmed(value) {
      return value?.trim() || void 0;
    }
    function childErrorMessage(span) {
      const fromErrorInfo = errorInfoMessage(span.errorInfo);
      if (fromErrorInfo)
        return fromErrorInfo;
      if (!TOOL_TYPES.has(span.type))
        return void 0;
      const fromOutput = (0, tool_result_1.toolResultError)(span.output);
      if (fromOutput)
        return fromOutput;
      if (span.attributes?.success === false) {
        return softFailureMessage(span.output) ?? "Tool failed";
      }
      return void 0;
    }
    function mastraUsage(span) {
      const fromOutput = span.output && typeof span.output === "object" ? (0, usage_1.normalizeTokenUsage)(span.output.usage) : void 0;
      if (fromOutput)
        return fromOutput;
      return (0, usage_1.normalizeTokenUsage)(span.attributes?.usage) ?? (0, usage_1.normalizeTokenUsage)(span.attributes);
    }
    var LemmaMastraExporter = class {
      options;
      name = "lemma";
      lemma;
      buffers = /* @__PURE__ */ new Map();
      pending = /* @__PURE__ */ new Set();
      pendingUsage;
      constructor(options = {}) {
        this.options = options;
        this.lemma = options.lemma;
      }
      getLemma() {
        this.lemma ??= new client_1.Lemma({
          apiKey: this.options.apiKey,
          projectId: this.options.projectId,
          baseUrl: this.options.baseUrl,
          fetch: this.options.fetch,
          release: this.options.release
        });
        return this.lemma;
      }
      bufferFor(traceId) {
        const existing = this.buffers.get(traceId);
        if (existing)
          return existing;
        const created = { children: [], childIds: /* @__PURE__ */ new Set() };
        this.buffers.set(traceId, created);
        return created;
      }
      pushChild(span) {
        const buffer = this.bufferFor(span.traceId);
        if (buffer.childIds.has(span.id)) {
          const index = buffer.children.findIndex((child) => child.id === span.id);
          if (index >= 0)
            buffer.children[index] = span;
          return;
        }
        buffer.childIds.add(span.id);
        buffer.children.push(span);
      }
      resolveThreadId(root) {
        const key = this.options.threadIdKey ?? "threadId";
        return lookupString([root.metadata, root.requestContext], [key]);
      }
      resolveUserId(root) {
        if (this.options.userIdKey) {
          return lookupString([root.metadata, root.requestContext], [this.options.userIdKey]);
        }
        return lookupString([root.metadata, root.requestContext], ["userId", "resourceId"]);
      }
      recordChild(trace, span, parentId) {
        const startedAt = toDate(span.startTime) ?? /* @__PURE__ */ new Date();
        const endedAt = toDate(span.endTime) ?? (span.isEvent ? startedAt : /* @__PURE__ */ new Date());
        const errorMessage = childErrorMessage(span);
        const status = errorMessage ? "ERROR" : void 0;
        const base = {
          id: span.id,
          parentId,
          name: span.name,
          input: span.input,
          output: errorMessage ? void 0 : span.output,
          metadata: this.options.metadata,
          attributes: {
            ...INTEGRATION_ATTRS,
            "mastra.span_type": span.type,
            "mastra.trace_id": span.traceId,
            "mastra.span_id": span.id,
            ...span.parentSpanId ? { "mastra.parent_span_id": span.parentSpanId } : {}
          },
          startedAt,
          endedAt,
          durationMs: durationMs(startedAt, endedAt),
          status,
          error: errorMessage
        };
        if (GENERATION_TYPES.has(span.type)) {
          const attrs = span.attributes;
          const llmInputMessages = asInputMessages(span.input);
          const llmOutputMessages = errorMessage ? void 0 : asOutputMessages(span.output);
          trace.recordGeneration({
            ...base,
            name: this.options.generationName ?? span.name,
            model: attributeString(attrs, "model"),
            llmProvider: attributeString(attrs, "provider"),
            llmInvocationParameters: attrs?.parameters,
            llmInputMessages,
            llmOutputMessages,
            usage: mastraUsage(span)
          });
          return;
        }
        if (TOOL_TYPES.has(span.type)) {
          const toolName = resolveToolName(span);
          trace.recordTool({
            ...base,
            name: this.options.toolName ?? span.name,
            toolName
          });
          return;
        }
        trace.recordSpan(base);
      }
      deliver(root, children) {
        const startedAt = toDate(root.startTime) ?? /* @__PURE__ */ new Date();
        const endedAt = toDate(root.endTime) ?? /* @__PURE__ */ new Date();
        const recordedIds = new Set(children.map((child) => child.id));
        const trace = this.getLemma().trace({
          id: root.traceId,
          name: this.options.agentName ?? resolveAgentName(root),
          input: rootTraceInput(root.input),
          metadata: {
            ...this.options.metadata,
            ...root.metadata ?? {},
            mastraTraceId: root.traceId,
            mastraSpanType: root.type,
            ...root.tags?.length ? { mastraTags: root.tags } : {}
          },
          threadId: this.resolveThreadId(root),
          userId: this.resolveUserId(root),
          durationMs: durationMs(startedAt, endedAt),
          startedAt
        });
        for (const child of children) {
          this.recordChild(trace, child, resolveParentId(child.parentSpanId, root.id, recordedIds));
        }
        if (this.pendingUsage !== void 0) {
          trace.applyGenerationUsage(this.pendingUsage);
          this.pendingUsage = void 0;
        }
        const rootError = errorInfoMessage(root.errorInfo);
        if (rootError) {
          trace.fail(rootError);
        }
        const endPromise = trace.end(rootError ? { durationMs: durationMs(startedAt, endedAt), endedAt } : {
          output: root.output,
          durationMs: durationMs(startedAt, endedAt),
          endedAt
        });
        this.pending.add(endPromise);
        void endPromise.finally(() => this.pending.delete(endPromise));
        return endPromise;
      }
      async exportTracingEvent(event) {
        if (event.type === "span_updated")
          return;
        const span = event.exportedSpan;
        if (event.type === "span_started") {
          if (span.isEvent) {
            this.pushChild(span);
          }
          return;
        }
        if (span.isRootSpan) {
          const buffer = this.buffers.get(span.traceId);
          const children = buffer?.children ?? [];
          this.buffers.delete(span.traceId);
          const promise = new Promise((resolve2, reject) => {
            (0, schedule_1.scheduleMacrotask)(() => {
              this.deliver(span, children).then(resolve2, reject);
            });
          });
          this.pending.add(promise);
          void promise.finally(() => this.pending.delete(promise));
          return;
        }
        this.pushChild(span);
      }
      /**
       * Copy token usage from an `agent.generate()` result onto generation spans
       * whose exported event omitted it. Call after generate returns.
       */
      recordResult(result) {
        this.pendingUsage = result;
        return 0;
      }
      /** Send completed traces and await ingest delivery. */
      async flush() {
        await Promise.all(Array.from(this.pending));
      }
      async shutdown() {
        await this.flush();
        this.buffers.clear();
      }
    };
    exports.LemmaMastraExporter = LemmaMastraExporter;
    function mastra(options = {}) {
      return new LemmaMastraExporter(options);
    }
  }
});

// ../../packages/ts/tracing/dist/openai-agents.js
var require_openai_agents = __commonJS({
  "../../packages/ts/tracing/dist/openai-agents.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.openAIAgents = openAIAgents;
    var client_1 = require_client();
    var error_message_1 = require_error_message();
    var schedule_1 = require_schedule();
    var tool_result_1 = require_tool_result();
    var usage_1 = require_usage();
    var INTEGRATION_ATTRS = {
      "lemma.sdk.integration": "openai-agents"
    };
    function parseMaybeJson(value) {
      if (typeof value !== "string")
        return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    function lookupString(sources, keys) {
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of keys) {
          const value = source[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return void 0;
    }
    function messageContent(message) {
      if (!message || typeof message !== "object")
        return message;
      const record = message;
      if ("content" in record)
        return record.content;
      return message;
    }
    function rootTraceInput(input) {
      if (typeof input === "string")
        return input;
      if (!Array.isArray(input) || input.length === 0)
        return input;
      for (let i = input.length - 1; i >= 0; i--) {
        const message = input[i];
        if (!message || typeof message !== "object")
          continue;
        const role = message.role;
        if (role === "user")
          return messageContent(message);
      }
      return messageContent(input[input.length - 1]);
    }
    function textFromGenerationOutput(output) {
      if (!Array.isArray(output))
        return output;
      const text = output.map((item) => {
        if (!item || typeof item !== "object")
          return "";
        const record = item;
        if (typeof record["text"] === "string")
          return record["text"];
        if (typeof record["content"] === "string")
          return record["content"];
        return "";
      }).join("");
      return text || output;
    }
    function responseOutput(data) {
      const response = data["response"] ?? data["_response"];
      if (response == null) {
        return textFromGenerationOutput(data["output"]);
      }
      if (typeof response === "object" && response !== null) {
        const record = response;
        if (typeof record.output_text === "string")
          return record.output_text;
        if (Array.isArray(record.output)) {
          return textFromGenerationOutput(record.output);
        }
        return response;
      }
      return response;
    }
    function spanName(data) {
      if (typeof data["name"] === "string" && data["name"]) {
        return data["name"];
      }
      if (data.type === "generation")
        return "openai-agents-generation";
      if (data.type === "response")
        return "openai-agents-response";
      if (data.type === "agent")
        return "openai-agents-agent";
      if (data.type === "guardrail")
        return "openai-agents-guardrail";
      if (data.type === "handoff") {
        const from = typeof data["from_agent"] === "string" ? data["from_agent"] : "";
        const to = typeof data["to_agent"] === "string" ? data["to_agent"] : "";
        return from && to ? `${from} to ${to}` : "openai-agents-handoff";
      }
      if (data.type === "speech" || data.type === "transcription") {
        return `openai-agents-${data.type}`;
      }
      if (data.type === "mcp_tools")
        return "openai-agents-mcp-tools";
      return `openai-agents-${data.type || "span"}`;
    }
    function openAIAttributes(span) {
      return Object.fromEntries(Object.entries({
        ...INTEGRATION_ATTRS,
        "openai.agents.trace_id": span.traceId,
        "openai.agents.span_id": span.spanId,
        "openai.agents.parent_id": span.parentId,
        "openai.agents.span_type": span.spanData.type,
        "openai.agents.trace_metadata": span.traceMetadata ? JSON.stringify(span.traceMetadata) : void 0,
        "openai.agents.span_data": JSON.stringify(span.spanData)
      }).filter(([, value]) => value !== void 0 && value !== null));
    }
    function generationUsage(data) {
      const direct = (0, usage_1.normalizeTokenUsage)(data["usage"]);
      if (direct)
        return direct;
      const response = data["response"] ?? data["_response"];
      if (response && typeof response === "object") {
        const record = response;
        const fromResponse = (0, usage_1.normalizeTokenUsage)(record.usage);
        if (fromResponse)
          return fromResponse;
      }
      return void 0;
    }
    function coerceDate(value) {
      if (value == null)
        return void 0;
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? void 0 : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? void 0 : parsed;
    }
    function startedAt(span) {
      return coerceDate(span.startedAt) ?? /* @__PURE__ */ new Date();
    }
    function endedAt(span) {
      return coerceDate(span.endedAt) ?? /* @__PURE__ */ new Date();
    }
    function durationMs(start, end) {
      return Math.max(0, end.getTime() - start.getTime());
    }
    function spanInput(data) {
      return parseMaybeJson(data["input"] ?? data["_input"]);
    }
    function isGenerationType(type) {
      return type === "generation" || type === "response";
    }
    function isTerminalFailureType(type) {
      return type === "agent" || type === "task" || type === "custom" || type === "guardrail";
    }
    function openAIAgents(options = {}) {
      const lemma = options.lemma ?? new client_1.Lemma({
        apiKey: options.apiKey,
        projectId: options.projectId,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        release: options.release
      });
      const traces = /* @__PURE__ */ new Map();
      const spans = /* @__PURE__ */ new Map();
      const endedSpans = /* @__PURE__ */ new Map();
      const pending = /* @__PURE__ */ new Set();
      function recordResult(result) {
        let stamped = 0;
        for (const stored of traces.values()) {
          if (stored.ended)
            continue;
          stamped += stored.handle.applyGenerationUsage(result);
        }
        return stamped;
      }
      function resolveThreadId(groupId, metadata) {
        if (typeof groupId === "string" && groupId)
          return groupId;
        const key = options.threadIdKey ?? "threadId";
        return lookupString([metadata, options.metadata], [key, "threadId", "thread_id"]);
      }
      function resolveUserId(metadata) {
        if (options.userIdKey) {
          return lookupString([metadata, options.metadata], [options.userIdKey]);
        }
        return lookupString([metadata, options.metadata], ["userId", "user_id", "resourceId"]);
      }
      function applyIdentity(stored, groupId, metadata) {
        const threadId = resolveThreadId(groupId, metadata);
        const userId = resolveUserId(metadata);
        if (threadId)
          stored.handle.threadId(threadId);
        if (userId)
          stored.handle.userId(userId);
      }
      function noteBounds(stored, start, end) {
        if (start) {
          stored.earliestStart = !stored.earliestStart || start < stored.earliestStart ? start : stored.earliestStart;
        }
        if (end) {
          stored.latestEnd = !stored.latestEnd || end > stored.latestEnd ? end : stored.latestEnd;
        }
      }
      function noteRootInput(stored, input) {
        if (input == null)
          return;
        if (stored.rootInput !== void 0)
          return;
        stored.rootInput = rootTraceInput(input);
        stored.handle.input(stored.rootInput);
      }
      function noteRootOutput(stored, output) {
        if (output == null || stored.rootError)
          return;
        stored.rootOutput = output;
      }
      function noteRootError(stored, error) {
        if (!error || stored.rootError)
          return;
        stored.rootError = error;
      }
      function ensureTrace(trace) {
        const existing = traces.get(trace.traceId);
        if (existing) {
          applyIdentity(existing, trace.groupId, trace.metadata);
          return existing;
        }
        const handle = lemma.trace({
          name: trace.name || "openai-agents-trace",
          metadata: {
            ...options.metadata,
            ...trace.metadata ?? {},
            openaiAgentsTraceId: trace.traceId,
            openaiAgentsGroupId: trace.groupId ?? void 0
          },
          threadId: resolveThreadId(trace.groupId, trace.metadata),
          userId: resolveUserId(trace.metadata)
        });
        const stored = {
          handle,
          ended: false,
          openedAt: /* @__PURE__ */ new Date()
        };
        traces.set(trace.traceId, stored);
        return stored;
      }
      function startSpan(span) {
        const trace = traces.get(span.traceId);
        if (!trace)
          return void 0;
        applyIdentity(trace, void 0, span.traceMetadata);
        const data = span.spanData;
        const input = spanInput(data);
        if (isGenerationType(data.type)) {
          noteRootInput(trace, input);
        }
        const spanStartedAt = startedAt(span);
        noteBounds(trace, spanStartedAt, void 0);
        const base = {
          id: span.spanId,
          parentId: span.parentId ?? null,
          name: spanName(data),
          input,
          metadata: options.metadata,
          attributes: openAIAttributes(span),
          startedAt: spanStartedAt
        };
        if (isGenerationType(data.type)) {
          return trace.handle.startGeneration({
            ...base,
            model: typeof data["model"] === "string" ? data["model"] : void 0,
            llmProvider: "openai",
            llmInputMessages: Array.isArray(input) ? input : void 0,
            llmInvocationParameters: data["model_config"]
          });
        }
        if (data.type === "function") {
          return trace.handle.startTool({
            ...base,
            toolName: typeof data["name"] === "string" ? data["name"] : void 0
          });
        }
        return trace.handle.startSpan(base);
      }
      function endSpan(span) {
        const storedTrace = traces.get(span.traceId);
        const handle = spans.get(span.spanId)?.handle ?? startSpan(span);
        if (!handle || !storedTrace)
          return;
        spans.delete(span.spanId);
        applyIdentity(storedTrace, void 0, span.traceMetadata);
        const data = span.spanData;
        const input = spanInput(data);
        if (isGenerationType(data.type)) {
          noteRootInput(storedTrace, input);
        }
        let rawOutput;
        if (data.type === "generation") {
          rawOutput = textFromGenerationOutput(data["output"]);
        } else if (data.type === "response") {
          rawOutput = responseOutput(data);
        } else {
          rawOutput = parseMaybeJson(data["output"] ?? data["_response"]);
        }
        const softError = data.type === "function" ? (0, tool_result_1.toolResultError)(rawOutput) : null;
        const hardError = span.error != null ? (0, error_message_1.describeError)(span.error) : void 0;
        const errorMessage = hardError ?? softError ?? void 0;
        const parsedOutput = errorMessage ? void 0 : rawOutput;
        const spanStartedAt = startedAt(span);
        const spanEndedAt = endedAt(span);
        noteBounds(storedTrace, spanStartedAt, spanEndedAt);
        if (hardError && isTerminalFailureType(data.type)) {
          noteRootError(storedTrace, hardError);
        }
        if (!errorMessage && isGenerationType(data.type) && parsedOutput != null) {
          noteRootOutput(storedTrace, parsedOutput);
        }
        handle.end({
          // Failures must not invent an output — record error instead.
          output: parsedOutput,
          error: errorMessage,
          status: errorMessage ? "ERROR" : void 0,
          model: typeof data["model"] === "string" ? data["model"] : void 0,
          endedAt: spanEndedAt,
          durationMs: durationMs(spanStartedAt, spanEndedAt),
          llmOutputMessages: errorMessage || data.type !== "generation" || !Array.isArray(data["output"]) ? void 0 : data["output"],
          usage: isGenerationType(data.type) ? generationUsage(data) : void 0
        });
        endedSpans.set(span.spanId, { handle, traceId: span.traceId });
        if (span.parentId && data.type === "function") {
          const parent = spans.get(span.parentId)?.handle ?? endedSpans.get(span.parentId)?.handle;
          parent?.ensureEndedAt(spanEndedAt);
        }
      }
      function forgetTraceSpans(traceId) {
        for (const [spanId, entry] of endedSpans) {
          if (entry.traceId === traceId)
            endedSpans.delete(spanId);
        }
        for (const [spanId, entry] of spans) {
          if (entry.traceId === traceId)
            spans.delete(spanId);
        }
      }
      async function finalizeTrace(traceId, stored) {
        traces.delete(traceId);
        forgetTraceSpans(traceId);
        if (stored.ended)
          return;
        stored.ended = true;
        const endedAtValue = stored.latestEnd ?? /* @__PURE__ */ new Date();
        const startedAtValue = stored.earliestStart ?? stored.openedAt ?? endedAtValue;
        const rootDuration = durationMs(startedAtValue, endedAtValue);
        const timing = {
          startedAt: startedAtValue,
          endedAt: endedAtValue,
          durationMs: rootDuration
        };
        if (stored.rootError) {
          stored.handle.fail(stored.rootError);
          await stored.handle.end(timing);
          return;
        }
        if (stored.rootOutput === void 0) {
          await stored.handle.end(timing);
          return;
        }
        await stored.handle.end({
          output: stored.rootOutput,
          ...timing
        });
      }
      async function finalizeAll() {
        await Promise.all(Array.from(traces.entries(), ([traceId, stored]) => finalizeTrace(traceId, stored)));
      }
      return {
        onTraceStart: async (trace) => {
          ensureTrace(trace);
        },
        onTraceEnd: async (trace) => {
          const stored = traces.get(trace.traceId);
          if (!stored)
            return;
          applyIdentity(stored, trace.groupId, trace.metadata);
          const promise = new Promise((resolve2, reject) => {
            (0, schedule_1.scheduleMacrotask)(() => {
              finalizeTrace(trace.traceId, stored).then(resolve2, reject);
            });
          });
          pending.add(promise);
          void promise.finally(() => pending.delete(promise));
        },
        onSpanStart: async (span) => {
          if (!traces.has(span.traceId))
            return;
          const handle = startSpan(span);
          if (handle)
            spans.set(span.spanId, { handle, traceId: span.traceId });
        },
        onSpanEnd: async (span) => {
          if (!traces.has(span.traceId))
            return;
          endSpan(span);
        },
        recordResult,
        // Shutdown/forceFlush finalize any still-open traces (a one-time terminal
        // send for traces that never received onTraceEnd), then drop them.
        shutdown: async () => {
          await finalizeAll();
          await Promise.all(pending);
        },
        forceFlush: async () => {
          await finalizeAll();
          await Promise.all(pending);
        }
      };
    }
  }
});

// ../../packages/ts/tracing/dist/vercel-ai.js
var require_vercel_ai = __commonJS({
  "../../packages/ts/tracing/dist/vercel-ai.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.vercelAI = vercelAI;
    var client_1 = require_client();
    var error_message_1 = require_error_message();
    var schedule_1 = require_schedule();
    var tool_result_1 = require_tool_result();
    var usage_1 = require_usage();
    var INTEGRATION_ATTRS = {
      "lemma.sdk.integration": "vercel-ai"
    };
    var CONCURRENT_REUSE_ERROR = "vercelAI() is already tracing a run. Create a new vercelAI() integration per concurrent AI SDK operation.";
    function addMs(startedAt, durationMs) {
      return typeof durationMs === "number" ? new Date(startedAt.getTime() + durationMs) : /* @__PURE__ */ new Date();
    }
    function subtractMs(endedAt, durationMs) {
      return typeof durationMs === "number" ? new Date(endedAt.getTime() - durationMs) : endedAt;
    }
    function v7StepKey(callId, stepNumber) {
      return `${callId}:${stepNumber}`;
    }
    function isV7StepStart(event) {
      return "callId" in event && "provider" in event && "modelId" in event;
    }
    function stringifyContent(content) {
      const text = content.map((part) => {
        if (!part || typeof part !== "object")
          return "";
        if (part.type !== "text")
          return "";
        return String(part.text ?? "");
      }).join("");
      if (text)
        return text;
      return JSON.stringify(content);
    }
    function structuredAssistantOutput(text, content) {
      if (typeof text === "string")
        return text;
      if (!content)
        return void 0;
      const hasNonText = content.some((part) => part && typeof part === "object" && part.type !== "text");
      if (hasNonText)
        return content;
      return stringifyContent(content);
    }
    function errorToolFields(error) {
      return { error, status: "ERROR" };
    }
    function toolOutput2(event) {
      if (event.toolOutput.type === "tool-error") {
        return errorToolFields(event.toolOutput.error);
      }
      const softError = (0, tool_result_1.toolResultError)(event.toolOutput.output);
      if (softError) {
        return errorToolFields(softError);
      }
      return { output: event.toolOutput.output };
    }
    function v6ToolOutput(event) {
      if (!event.success) {
        return errorToolFields(event.error);
      }
      const softError = (0, tool_result_1.toolResultError)(event.output);
      if (softError) {
        return errorToolFields(softError);
      }
      return { output: event.output };
    }
    function resolveDurationMs(startedAt, endedAt, reportedMs) {
      const wallMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
      if (typeof reportedMs !== "number")
        return wallMs;
      return Math.max(reportedMs, wallMs);
    }
    function messageContent(message) {
      if (!message || typeof message !== "object")
        return message;
      const record = message;
      if ("content" in record)
        return record.content;
      return message;
    }
    function lookupString(sources, keys) {
      for (const source of sources) {
        if (!source)
          continue;
        for (const key of keys) {
          const value = source[key];
          if (typeof value === "string" && value)
            return value;
        }
      }
      return void 0;
    }
    function v6NormalizedMessages(event) {
      if (Array.isArray(event.messages))
        return event.messages;
      const messages = [];
      if ("system" in event && typeof event.system === "string" && event.system) {
        messages.push({ role: "system", content: event.system });
      }
      if ("prompt" in event && event.prompt !== void 0) {
        if (Array.isArray(event.prompt)) {
          return messages.length > 0 ? [...messages, ...event.prompt] : event.prompt;
        }
        if (typeof event.prompt === "string") {
          messages.push({ role: "user", content: event.prompt });
        }
      }
      return messages.length > 0 ? messages : void 0;
    }
    function v6Input(event) {
      const normalized = v6NormalizedMessages(event);
      if (normalized)
        return normalized;
      if ("prompt" in event)
        return event.prompt;
      return void 0;
    }
    function rootTraceInput(input) {
      if (typeof input === "string")
        return input;
      if (!Array.isArray(input) || input.length === 0)
        return input;
      for (let i = input.length - 1; i >= 0; i--) {
        const message = input[i];
        if (!message || typeof message !== "object")
          continue;
        const role = message.role;
        if (role === "user")
          return messageContent(message);
      }
      return messageContent(input[input.length - 1]);
    }
    function eventTraceInput(event) {
      if (!event)
        return void 0;
      if ("messages" in event || "prompt" in event || "system" in event) {
        if (!("callId" in event) || "model" in event) {
          return v6Input(event);
        }
      }
      if ("messages" in event && event.messages)
        return event.messages;
      if ("prompt" in event)
        return event.prompt;
      return void 0;
    }
    function eventMetadata(event) {
      return event && "metadata" in event ? event.metadata ?? void 0 : void 0;
    }
    function traceName(options, event) {
      if (options.agentName)
        return options.agentName;
      const functionId = event && "functionId" in event && typeof event.functionId === "string" ? event.functionId : void 0;
      return functionId || "vercel-ai-agent";
    }
    function v6Output(event) {
      return structuredAssistantOutput(event.text, event.content);
    }
    function endOutput(event) {
      return structuredAssistantOutput(event.text, event.content);
    }
    function eventUsage(event) {
      return (0, usage_1.normalizeTokenUsage)(event.usage) ?? (0, usage_1.normalizeTokenUsage)(event.totalUsage);
    }
    function withIntegrationAttrs(attributes) {
      return { ...INTEGRATION_ATTRS, ...attributes ?? {} };
    }
    function vercelAI(options = {}) {
      let lemma = options.lemma;
      const pending = /* @__PURE__ */ new Set();
      let phase = "idle";
      let modelCalls = /* @__PURE__ */ new Map();
      let v7Steps = /* @__PURE__ */ new Map();
      let v6Steps = /* @__PURE__ */ new Map();
      let v6Starts = [];
      let generationSpanIdsByCallId = /* @__PURE__ */ new Map();
      let generationSpanIdsByToolCallId = /* @__PURE__ */ new Map();
      let generationHandlesById = /* @__PURE__ */ new Map();
      let toolExecutions = /* @__PURE__ */ new Map();
      let latestV6GenerationId;
      let managedTrace;
      let recordedV6Step = false;
      let sawV7StepZero = false;
      let runStartedAt;
      let runError;
      let endingTrace;
      let deliverOwnedTrace;
      function resetRunState() {
        phase = "idle";
        modelCalls = /* @__PURE__ */ new Map();
        v7Steps = /* @__PURE__ */ new Map();
        v6Steps = /* @__PURE__ */ new Map();
        v6Starts = [];
        generationSpanIdsByCallId = /* @__PURE__ */ new Map();
        generationSpanIdsByToolCallId = /* @__PURE__ */ new Map();
        generationHandlesById = /* @__PURE__ */ new Map();
        toolExecutions = /* @__PURE__ */ new Map();
        latestV6GenerationId = void 0;
        managedTrace = void 0;
        recordedV6Step = false;
        sawV7StepZero = false;
        runStartedAt = void 0;
        runError = void 0;
        endingTrace = void 0;
        deliverOwnedTrace = void 0;
      }
      function trackGeneration(handle) {
        generationHandlesById.set(handle.id, handle);
      }
      function coverParent(parentId, endedAt) {
        if (!parentId)
          return;
        generationHandlesById.get(parentId)?.ensureEndedAt(endedAt);
      }
      function getLemma() {
        lemma ??= new client_1.Lemma({
          apiKey: options.apiKey,
          projectId: options.projectId,
          baseUrl: options.baseUrl,
          fetch: options.fetch,
          release: options.release
        });
        return lemma;
      }
      function resolveThreadId(metadata) {
        const key = options.threadIdKey ?? "threadId";
        return lookupString([metadata, options.metadata], [key]);
      }
      function resolveUserId(metadata) {
        const key = options.userIdKey ?? "userId";
        return lookupString([metadata, options.metadata], [key]);
      }
      function mergedMetadata(metadata) {
        return {
          ...options.metadata,
          ...metadata ?? {}
        };
      }
      function beginActivity() {
        if (phase === "idle") {
          phase = "active";
          runStartedAt = /* @__PURE__ */ new Date();
        }
      }
      function beginNewRun() {
        if (phase === "active" || phase === "ending") {
          throw new Error(CONCURRENT_REUSE_ERROR);
        }
        resetRunState();
        phase = "active";
        runStartedAt = /* @__PURE__ */ new Date();
      }
      function hasExplicitEndableTrace() {
        const trace = options.trace;
        return Boolean(trace && typeof trace.end === "function");
      }
      function applyIdentity(trace, metadata) {
        const threadId = resolveThreadId(metadata);
        const userId = resolveUserId(metadata);
        if (threadId)
          trace.threadId(threadId);
        if (userId)
          trace.userId(userId);
      }
      function resolveTrace(event) {
        if (phase === "ending") {
          const trace = options.trace ?? managedTrace;
          return trace ? {
            trace,
            source: options.trace ? "explicit" : "managed"
          } : null;
        }
        beginActivity();
        const metadata = eventMetadata(event);
        if (options.trace) {
          applyIdentity(options.trace, metadata);
          return { trace: options.trace, source: "explicit" };
        }
        if (!managedTrace) {
          const rawInput = eventTraceInput(event);
          managedTrace = getLemma().trace({
            name: traceName(options, event),
            input: rootTraceInput(rawInput),
            metadata: mergedMetadata(metadata),
            threadId: resolveThreadId(metadata),
            userId: resolveUserId(metadata),
            startedAt: runStartedAt
          });
        } else {
          applyIdentity(managedTrace, metadata);
          if (event) {
            const rawInput = eventTraceInput(event);
            if (rawInput !== void 0) {
              managedTrace.input(rootTraceInput(rawInput));
            }
          }
        }
        return { trace: managedTrace, source: "managed" };
      }
      function trackPending(promise) {
        pending.add(promise);
        void promise.finally(() => pending.delete(promise));
        return promise;
      }
      function ensureManagedTrace(event) {
        if (options.trace || managedTrace)
          return;
        beginActivity();
        managedTrace = getLemma().trace({
          name: traceName(options, event),
          metadata: mergedMetadata(eventMetadata(event)),
          threadId: resolveThreadId(eventMetadata(event)),
          userId: resolveUserId(eventMetadata(event)),
          startedAt: runStartedAt
        });
      }
      async function endOwnedTrace(event) {
        if (phase === "idle")
          return;
        if (phase === "ending")
          return;
        phase = "ending";
        const trace = options.trace;
        let ownedTrace;
        let explicit = false;
        if (trace && typeof trace.end === "function") {
          explicit = true;
          ownedTrace = {
            end: trace.end.bind(trace),
            fail: trace.fail.bind(trace),
            output: trace.output.bind(trace)
          };
        } else {
          ensureManagedTrace(event);
          if (managedTrace) {
            ownedTrace = managedTrace;
          }
        }
        const identityTrace = options.trace ?? managedTrace;
        if (identityTrace) {
          applyIdentity(identityTrace, eventMetadata(event));
        }
        const eventError = "error" in event && event.error != null ? (0, error_message_1.describeError)(event.error) : void 0;
        if (eventError && !runError) {
          runError = eventError;
        }
        const endedAt = /* @__PURE__ */ new Date();
        const startedAt = runStartedAt ?? endedAt;
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        const successOutput = endOutput(event);
        endingTrace = ownedTrace;
        let delivered = false;
        const deliver = async () => {
          if (delivered)
            return;
          delivered = true;
          try {
            if (!ownedTrace)
              return;
            const terminalError = runError;
            const timing = explicit ? { endedAt } : { durationMs, endedAt };
            if (terminalError) {
              ownedTrace.fail(terminalError);
              ownedTrace.output(void 0);
              await ownedTrace.end(timing);
              return;
            }
            if (successOutput === void 0) {
              await ownedTrace.end(timing);
            } else {
              await ownedTrace.end({
                output: successOutput,
                ...timing
              });
            }
          } finally {
            resetRunState();
          }
        };
        deliverOwnedTrace = deliver;
        trackPending(new Promise((resolve2, reject) => {
          (0, schedule_1.scheduleMacrotask)(() => {
            deliver().then(resolve2, reject);
          });
        }));
      }
      function recordResult(result) {
        const trace = options.trace ?? managedTrace;
        if (!trace)
          return 0;
        return trace.applyGenerationUsage(result);
      }
      function recordV6Generation(event, stored) {
        const resolved = resolveTrace(stored?.event);
        if (!resolved)
          return;
        const { trace } = resolved;
        const startedAt = stored?.startedAt ?? /* @__PURE__ */ new Date();
        const endedAt = /* @__PURE__ */ new Date();
        const durationMs = resolveDurationMs(startedAt, endedAt, void 0);
        const id = crypto.randomUUID();
        const name = typeof options.generationName === "function" ? options.generationName(event) : options.generationName ?? "vercel-ai-generation";
        const output = v6Output(event);
        const generationError = "error" in event && event.error != null ? (0, error_message_1.describeError)(event.error) : void 0;
        const generation = {
          name,
          input: stored?.event && v6Input(stored.event),
          output: generationError ? void 0 : output,
          metadata: options.metadata,
          attributes: withIntegrationAttrs(),
          model: event.model.modelId,
          startedAt,
          endedAt,
          durationMs,
          llmProvider: event.model.provider,
          llmInputMessages: stored?.event ? v6NormalizedMessages(stored.event) : void 0,
          llmOutputMessages: output === void 0 || generationError ? void 0 : [{ role: "assistant", content: output }],
          llmTools: stored?.event.tools,
          status: generationError ? "ERROR" : void 0,
          error: generationError,
          usage: eventUsage(event)
        };
        if (stored?.handle) {
          stored.handle.end(generation);
          latestV6GenerationId = stored.handle.id;
          trackGeneration(stored.handle);
          return;
        }
        trace.recordGeneration({
          id,
          ...generation
        });
        latestV6GenerationId = id;
      }
      function startV7Generation(event) {
        if (event.stepNumber === 0) {
          if (sawV7StepZero && phase === "active") {
            throw new Error(CONCURRENT_REUSE_ERROR);
          }
          sawV7StepZero = true;
        }
        const resolved = resolveTrace(event);
        if (!resolved)
          return;
        const { trace } = resolved;
        const name = typeof options.generationName === "function" ? options.generationName({
          callId: event.callId,
          provider: event.provider,
          modelId: event.modelId,
          content: [],
          performance: {}
        }) : options.generationName ?? "vercel-ai-generation";
        const startedAt = /* @__PURE__ */ new Date();
        const handle = trace.startGeneration({
          name,
          input: event.messages,
          metadata: options.metadata,
          attributes: withIntegrationAttrs(),
          model: event.modelId,
          startedAt,
          llmProvider: event.provider,
          llmInputMessages: event.messages,
          llmTools: event.tools
        });
        const stored = { event, startedAt, handle };
        v7Steps.set(v7StepKey(event.callId, event.stepNumber), stored);
        generationSpanIdsByCallId.set(event.callId, handle.id);
        trackGeneration(handle);
      }
      function startV6Generation(event, key) {
        const resolved = resolveTrace(event);
        if (!resolved)
          return void 0;
        const { trace } = resolved;
        const startedAt = /* @__PURE__ */ new Date();
        const name = typeof options.generationName === "function" ? options.generationName({
          stepNumber: "stepNumber" in event ? event.stepNumber : 0,
          model: event.model
        }) : options.generationName ?? "vercel-ai-generation";
        const input = v6Input(event);
        const handle = trace.startGeneration({
          name,
          input,
          metadata: options.metadata,
          attributes: withIntegrationAttrs(),
          model: event.model.modelId,
          startedAt,
          llmProvider: event.model.provider,
          llmInputMessages: v6NormalizedMessages(event),
          llmTools: event.tools
        });
        latestV6GenerationId = handle.id;
        trackGeneration(handle);
        return { event, startedAt, handle, key };
      }
      function endV7Generation(event) {
        const key = v7StepKey(event.callId, event.stepNumber);
        const stored = v7Steps.get(key);
        v7Steps.delete(key);
        if (!stored)
          return;
        const endedAt = /* @__PURE__ */ new Date();
        const durationMs = resolveDurationMs(stored.startedAt, endedAt, event.performance?.stepTimeMs ?? event.performance?.responseTimeMs);
        const output = structuredAssistantOutput(event.text, event.content);
        const generationError = event.error != null ? (0, error_message_1.describeError)(event.error) : void 0;
        for (const toolCall of event.toolCalls ?? []) {
          if (toolCall.toolCallId) {
            generationSpanIdsByToolCallId.set(toolCall.toolCallId, stored.handle.id);
          }
        }
        stored.handle.end({
          output: generationError ? void 0 : output,
          model: event.model.modelId,
          durationMs,
          endedAt: addMs(stored.startedAt, durationMs),
          llmProvider: event.model.provider,
          llmOutputMessages: output === void 0 || generationError ? void 0 : [{ role: "assistant", content: output }],
          status: generationError ? "ERROR" : void 0,
          error: generationError,
          usage: eventUsage(event)
        });
      }
      function resolveToolParentId(callId, toolCallId) {
        return toolCallId && generationSpanIdsByToolCallId.get(toolCallId) || (callId ? generationSpanIdsByCallId.get(callId) : void 0) || latestV6GenerationId;
      }
      const integration = {
        onLanguageModelCallStart(event) {
          if (phase === "active" && generationSpanIdsByCallId.size > 0 && !generationSpanIdsByCallId.has(event.callId)) {
            const belongsToActiveStep = [...v7Steps.values()].some((step) => step.event.callId === event.callId);
            if (!belongsToActiveStep) {
              throw new Error(CONCURRENT_REUSE_ERROR);
            }
          }
          const resolved = resolveTrace(event);
          if (!resolved)
            return;
          const { trace } = resolved;
          if (generationSpanIdsByCallId.has(event.callId)) {
            modelCalls.set(event.callId, { event, startedAt: /* @__PURE__ */ new Date() });
            return;
          }
          const startedAt = /* @__PURE__ */ new Date();
          const name = typeof options.generationName === "function" ? options.generationName({
            callId: event.callId,
            provider: event.provider,
            modelId: event.modelId,
            content: [],
            performance: {}
          }) : options.generationName ?? "vercel-ai-generation";
          const handle = trace.startGeneration({
            name,
            input: event.messages,
            metadata: options.metadata,
            attributes: withIntegrationAttrs(),
            model: event.modelId,
            startedAt,
            llmProvider: event.provider,
            llmInputMessages: event.messages,
            llmTools: event.tools
          });
          modelCalls.set(event.callId, { event, startedAt, handle });
          generationSpanIdsByCallId.set(event.callId, handle.id);
          trackGeneration(handle);
        },
        onLanguageModelCallEnd(event) {
          if (phase !== "active" && phase !== "ending")
            return;
          const stored = modelCalls.get(event.callId);
          modelCalls.delete(event.callId);
          if (!stored?.handle)
            return;
          const endedAt = /* @__PURE__ */ new Date();
          const durationMs = resolveDurationMs(stored.startedAt, endedAt, event.performance.responseTimeMs);
          const output = structuredAssistantOutput(void 0, event.content);
          stored.handle.end({
            output,
            model: event.modelId,
            durationMs,
            endedAt: addMs(stored.startedAt, durationMs),
            llmProvider: event.provider,
            llmOutputMessages: output === void 0 ? void 0 : [{ role: "assistant", content: output }],
            usage: eventUsage(event)
          });
        },
        onToolExecutionStart(event) {
          const resolved = resolveTrace();
          if (!resolved)
            return;
          const { trace } = resolved;
          const parentId = resolveToolParentId(event.callId, event.toolCall.toolCallId);
          const name = typeof options.toolName === "function" ? options.toolName({
            ...event,
            toolExecutionMs: void 0,
            toolOutput: { type: "tool-result" }
          }) : options.toolName ?? event.toolCall.toolName;
          const startedAt = /* @__PURE__ */ new Date();
          const handle = trace.startTool({
            name,
            parentId,
            input: event.toolCall.input,
            metadata: options.metadata,
            attributes: withIntegrationAttrs(),
            startedAt,
            toolName: event.toolCall.toolName
          });
          if (event.toolCall.toolCallId) {
            toolExecutions.set(event.toolCall.toolCallId, {
              handle,
              startedAt,
              parentId
            });
          }
        },
        onToolCallStart(event) {
          integration.onToolExecutionStart?.(event);
        },
        onToolExecutionEnd(event) {
          const resolved = resolveTrace();
          if (!resolved)
            return;
          const { trace } = resolved;
          const name = typeof options.toolName === "function" ? options.toolName(event) : options.toolName ?? event.toolCall.toolName;
          const storedTool = event.toolCall.toolCallId ? toolExecutions.get(event.toolCall.toolCallId) : void 0;
          if (event.toolCall.toolCallId) {
            toolExecutions.delete(event.toolCall.toolCallId);
          }
          if (storedTool) {
            const endedAt2 = addMs(storedTool.startedAt, event.toolExecutionMs);
            const durationMs2 = resolveDurationMs(storedTool.startedAt, endedAt2, event.toolExecutionMs);
            storedTool.handle.end({
              durationMs: durationMs2,
              endedAt: addMs(storedTool.startedAt, durationMs2),
              toolName: event.toolCall.toolName,
              ...toolOutput2(event)
            });
            coverParent(storedTool.parentId, addMs(storedTool.startedAt, durationMs2));
            return;
          }
          const endedAt = /* @__PURE__ */ new Date();
          const startedAt = subtractMs(endedAt, event.toolExecutionMs);
          const durationMs = resolveDurationMs(startedAt, endedAt, event.toolExecutionMs);
          const parentId = resolveToolParentId(event.callId, event.toolCall.toolCallId);
          trace.recordTool({
            name,
            parentId,
            toolName: event.toolCall.toolName,
            input: event.toolCall.input,
            metadata: options.metadata,
            attributes: withIntegrationAttrs(),
            durationMs,
            startedAt: subtractMs(endedAt, durationMs),
            endedAt,
            ...toolOutput2(event)
          });
          coverParent(parentId, endedAt);
        },
        onStart(event) {
          beginNewRun();
          recordedV6Step = false;
          const key = `start:${v6Starts.length}:${Date.now()}`;
          v6Starts.push({ event, startedAt: /* @__PURE__ */ new Date(), key });
          resolveTrace(event);
        },
        onStepStart(event) {
          if (isV7StepStart(event)) {
            startV7Generation(event);
            return;
          }
          const key = `step:${event.stepNumber}`;
          if (v6Steps.has(key)) {
            return;
          }
          const stored = startV6Generation(event, key);
          if (stored)
            v6Steps.set(key, stored);
        },
        onStepEnd(event) {
          if (phase !== "active" && phase !== "ending")
            return;
          endV7Generation(event);
        },
        onStepFinish(event) {
          if (phase !== "active" && phase !== "ending")
            return;
          recordedV6Step = true;
          const key = `step:${event.stepNumber}`;
          const stored = v6Steps.get(key);
          v6Steps.delete(key);
          recordV6Generation(event, stored);
        },
        async onFinish(event) {
          if (phase === "idle") {
            if (!hasExplicitEndableTrace())
              return;
            beginActivity();
          }
          if (phase === "active") {
            if (recordedV6Step) {
              v6Starts.shift();
              recordedV6Step = false;
            } else {
              recordV6Generation(event, v6Starts.shift());
            }
          }
          await endOwnedTrace(event);
        },
        async onEnd(event) {
          if (phase === "idle") {
            if (!hasExplicitEndableTrace())
              return;
            beginActivity();
          }
          await endOwnedTrace(event);
        },
        onToolCallFinish(event) {
          const resolved = resolveTrace();
          if (!resolved)
            return;
          const { trace } = resolved;
          const name = typeof options.toolName === "function" ? options.toolName(event) : options.toolName ?? event.toolCall.toolName;
          const storedTool = event.toolCall.toolCallId ? toolExecutions.get(event.toolCall.toolCallId) : void 0;
          if (event.toolCall.toolCallId) {
            toolExecutions.delete(event.toolCall.toolCallId);
          }
          if (storedTool) {
            const endedAt2 = addMs(storedTool.startedAt, event.durationMs);
            const durationMs2 = resolveDurationMs(storedTool.startedAt, endedAt2, event.durationMs);
            const toolEndedAt = addMs(storedTool.startedAt, durationMs2);
            storedTool.handle.end({
              durationMs: durationMs2,
              endedAt: toolEndedAt,
              toolName: event.toolCall.toolName,
              ...v6ToolOutput(event)
            });
            coverParent(storedTool.parentId, toolEndedAt);
            return;
          }
          const endedAt = /* @__PURE__ */ new Date();
          const durationMs = resolveDurationMs(subtractMs(endedAt, event.durationMs), endedAt, event.durationMs);
          const startedAt = subtractMs(endedAt, durationMs);
          const parentId = resolveToolParentId(void 0, event.toolCall.toolCallId);
          trace.recordTool({
            name,
            parentId,
            toolName: event.toolCall.toolName,
            input: event.toolCall.input,
            metadata: options.metadata,
            attributes: withIntegrationAttrs(),
            durationMs,
            startedAt,
            endedAt,
            ...v6ToolOutput(event)
          });
          coverParent(parentId, endedAt);
        },
        async fail(error) {
          const message = (0, error_message_1.describeError)(error);
          runError = message;
          if (phase === "ending") {
            endingTrace?.fail(message);
            endingTrace?.output(void 0);
            return;
          }
          if (phase === "idle") {
            beginActivity();
          }
          await endOwnedTrace({ error });
          if (deliverOwnedTrace)
            await deliverOwnedTrace();
        },
        recordResult,
        async flush() {
          if (deliverOwnedTrace)
            await deliverOwnedTrace();
          await Promise.all(Array.from(pending));
        },
        async shutdown() {
          if (phase === "active") {
            await endOwnedTrace({});
          }
          await integration.flush();
          resetRunState();
        }
      };
      return integration;
    }
  }
});

// ../../packages/ts/tracing/dist/index.js
var require_dist = __commonJS({
  "../../packages/ts/tracing/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.vercelAI = exports.openAIAgents = exports.mastra = exports.LemmaMastraExporter = exports.langGraph = exports.langChain = exports.LemmaLangChainCallbackHandler = exports.LangChainCallbackHandler = exports.lemmaDebug = exports.isDebugVerifyEnabled = exports.isDebugModeEnabled = exports.enableDebugMode = exports.disableDebugMode = exports.RELEASE_MAX_LENGTH = exports.normalizeRelease = exports.startCodingAgentTurn = exports.recordCodingAgentToolStart = exports.recordCodingAgentToolResult = exports.completeCodingAgentTurn = exports.codingAgentTurnTrace = exports.toWireTokenUsage = exports.normalizeTokenUsage = exports.attachResultUsage = exports.TraceHandle = exports.TraceContext = exports.SpanHandle = exports.NoopSpanHandle = exports.Lemma = void 0;
    var client_1 = require_client();
    Object.defineProperty(exports, "Lemma", { enumerable: true, get: function() {
      return client_1.Lemma;
    } });
    Object.defineProperty(exports, "NoopSpanHandle", { enumerable: true, get: function() {
      return client_1.NoopSpanHandle;
    } });
    Object.defineProperty(exports, "SpanHandle", { enumerable: true, get: function() {
      return client_1.SpanHandle;
    } });
    Object.defineProperty(exports, "TraceContext", { enumerable: true, get: function() {
      return client_1.TraceContext;
    } });
    Object.defineProperty(exports, "TraceHandle", { enumerable: true, get: function() {
      return client_1.TraceHandle;
    } });
    Object.defineProperty(exports, "attachResultUsage", { enumerable: true, get: function() {
      return client_1.attachResultUsage;
    } });
    Object.defineProperty(exports, "normalizeTokenUsage", { enumerable: true, get: function() {
      return client_1.normalizeTokenUsage;
    } });
    Object.defineProperty(exports, "toWireTokenUsage", { enumerable: true, get: function() {
      return client_1.toWireTokenUsage;
    } });
    var coding_agent_1 = require_coding_agent();
    Object.defineProperty(exports, "codingAgentTurnTrace", { enumerable: true, get: function() {
      return coding_agent_1.codingAgentTurnTrace;
    } });
    Object.defineProperty(exports, "completeCodingAgentTurn", { enumerable: true, get: function() {
      return coding_agent_1.completeCodingAgentTurn;
    } });
    Object.defineProperty(exports, "recordCodingAgentToolResult", { enumerable: true, get: function() {
      return coding_agent_1.recordCodingAgentToolResult;
    } });
    Object.defineProperty(exports, "recordCodingAgentToolStart", { enumerable: true, get: function() {
      return coding_agent_1.recordCodingAgentToolStart;
    } });
    Object.defineProperty(exports, "startCodingAgentTurn", { enumerable: true, get: function() {
      return coding_agent_1.startCodingAgentTurn;
    } });
    var release_1 = require_release();
    Object.defineProperty(exports, "normalizeRelease", { enumerable: true, get: function() {
      return release_1.normalizeRelease;
    } });
    Object.defineProperty(exports, "RELEASE_MAX_LENGTH", { enumerable: true, get: function() {
      return release_1.RELEASE_MAX_LENGTH;
    } });
    var debug_mode_1 = require_debug_mode();
    Object.defineProperty(exports, "disableDebugMode", { enumerable: true, get: function() {
      return debug_mode_1.disableDebugMode;
    } });
    Object.defineProperty(exports, "enableDebugMode", { enumerable: true, get: function() {
      return debug_mode_1.enableDebugMode;
    } });
    Object.defineProperty(exports, "isDebugModeEnabled", { enumerable: true, get: function() {
      return debug_mode_1.isDebugModeEnabled;
    } });
    Object.defineProperty(exports, "isDebugVerifyEnabled", { enumerable: true, get: function() {
      return debug_mode_1.isDebugVerifyEnabled;
    } });
    Object.defineProperty(exports, "lemmaDebug", { enumerable: true, get: function() {
      return debug_mode_1.lemmaDebug;
    } });
    var langchain_1 = require_langchain();
    Object.defineProperty(exports, "LangChainCallbackHandler", { enumerable: true, get: function() {
      return langchain_1.LangChainCallbackHandler;
    } });
    Object.defineProperty(exports, "LemmaLangChainCallbackHandler", { enumerable: true, get: function() {
      return langchain_1.LemmaLangChainCallbackHandler;
    } });
    Object.defineProperty(exports, "langChain", { enumerable: true, get: function() {
      return langchain_1.langChain;
    } });
    Object.defineProperty(exports, "langGraph", { enumerable: true, get: function() {
      return langchain_1.langGraph;
    } });
    var mastra_1 = require_mastra();
    Object.defineProperty(exports, "LemmaMastraExporter", { enumerable: true, get: function() {
      return mastra_1.LemmaMastraExporter;
    } });
    Object.defineProperty(exports, "mastra", { enumerable: true, get: function() {
      return mastra_1.mastra;
    } });
    var openai_agents_1 = require_openai_agents();
    Object.defineProperty(exports, "openAIAgents", { enumerable: true, get: function() {
      return openai_agents_1.openAIAgents;
    } });
    var vercel_ai_1 = require_vercel_ai();
    Object.defineProperty(exports, "vercelAI", { enumerable: true, get: function() {
      return vercel_ai_1.vercelAI;
    } });
  }
});

// src/adapter.ts
var import_tracing = __toESM(require_dist(), 1);

// src/pending.ts
import { randomUUID } from "node:crypto";
import { chmod as chmod2, mkdir as mkdir2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/storage.ts
import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var LEMMA_OPENCODE_CREDENTIALS_HELP = "Lemma OpenCode credentials are missing or invalid. Run `pnpm dlx @uselemma/opencode setup` to connect or rotate the scoped credential.";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && value.apiUrl.length > 0 && typeof value.projectId === "string" && value.projectId.length > 0 && typeof value.credentialId === "string" && value.credentialId.length > 0 && typeof value.accessToken === "string" && value.accessToken.length > 0;
}
function resolveConfigDir(options = {}) {
  if (options.configDir) return resolve(options.configDir);
  const env = options.env ?? process.env;
  const configured = env.OPENCODE_CONFIG_DIR?.trim();
  if (configured) return resolve(configured);
  const home = options.homeDir ?? homedir();
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome ? join(resolve(xdgConfigHome), "opencode") : join(resolve(home), ".config", "opencode");
}
function defaultDataDir(options) {
  return join(resolveConfigDir(options), "lemma");
}
function dataDirLocationPath(options) {
  return join(defaultDataDir(options), "data-dir-location.json");
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return resolve(options.dataDir);
  const env = options.env ?? process.env;
  const configured = env.LEMMA_OPENCODE_DATA_DIR?.trim();
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
    if (!isCredentials(value)) throw new Error(LEMMA_OPENCODE_CREDENTIALS_HELP);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(LEMMA_OPENCODE_CREDENTIALS_HELP);
    }
    throw error;
  }
}

// src/pending.ts
function isPendingOpenCodeTurn(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const pending = value;
  const turn = pending.turn;
  return pending.version === 1 && typeof pending.apiUrl === "string" && typeof pending.projectId === "string" && typeof pending.credentialId === "string" && typeof turn === "object" && turn !== null && !Array.isArray(turn) && turn.harness === "opencode" && turn.status === "completed";
}
async function writePendingTurn(turn, scope, options = {}) {
  const pendingDir = join2(resolveDataDir(options), "pending");
  await mkdir2(pendingDir, { recursive: true, mode: 448 });
  if (process.platform !== "win32") await chmod2(pendingDir, 448);
  const entry = `${turn.endedAt.replaceAll(/[^0-9]/g, "")}-${turn.traceId}-${randomUUID()}.json`;
  const path = join2(pendingDir, entry);
  const temporaryPath = `${path}.tmp`;
  const pending = {
    version: 1,
    apiUrl: scope.apiUrl,
    projectId: scope.projectId,
    credentialId: scope.credentialId,
    turn
  };
  await writeFile2(temporaryPath, `${JSON.stringify(pending)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  if (process.platform !== "win32") await chmod2(temporaryPath, 384);
  await rename2(temporaryPath, path);
  return true;
}

// src/sanitize.ts
var SENSITIVE_KEYS = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "credential",
  "private_key",
  "aws_secret_access_key",
  "connection_string",
  "database_url",
  "database_uri",
  "db_url",
  "stripe_secret_key"
]);
var SENSITIVE_KEY_SUFFIXES = [
  "_authorization",
  "_cookie",
  "_password",
  "_passwd",
  "_secret",
  "_token",
  "_api_key",
  "_apikey",
  "_credential",
  "_private_key",
  "_access_key",
  "_secret_key",
  "_connection_string",
  "_database_url",
  "_database_uri"
];
var SECRET_ASSIGNMENT = /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?!["']?\[REDACTED\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)/g;
var AUTHORIZATION_HEADER = /(\bAuthorization\s*:\s*)(?:Basic|Bearer|Digest|Negotiate|AWS4-HMAC-SHA256)\s+[^\r\n]+/gi;
var JSON_COOKIE_VALUE = /("(?:Cookie|Set-Cookie)"\s*:\s*)(?:\[(?:\s*"(?:\\.|[^"\\])*"\s*,?)*\s*\]|"(?:\\.|[^"\\])*")/gi;
var COOKIE_HEADER = /(\b(?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi;
var AUTHORIZATION_TOKEN = /\b(?:Basic|Bearer)\s+(?=[^\s,;}\]\r\n]{8,})(?=[^\s,;}\]\r\n]*[0-9_~+/-])[^\s,;}\]\r\n]+/gi;
var PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----|$)/g;
var PROVIDER_TOKEN = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|lemma_[A-Za-z0-9_-]{16,})\b/g;
var JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
var CREDENTIAL_BEARING_URL = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizedKey(key) {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replaceAll(/[-.]/g, "_");
}
function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
function sanitizeValue(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (value === null || ["boolean", "number"].includes(typeof value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.replace(PEM_BLOCK, "[PEM REDACTED]").replace(AUTHORIZATION_HEADER, "$1[REDACTED]").replace(JSON_COOKIE_VALUE, '$1"[REDACTED]"').replace(COOKIE_HEADER, "$1[REDACTED]").replace(AUTHORIZATION_TOKEN, "[REDACTED]").replace(
      SECRET_ASSIGNMENT,
      (match, opening, key, separator) => isSensitiveKey(key) ? `${opening}${key}${separator}[REDACTED]` : match
    ).replace(CREDENTIAL_BEARING_URL, "$1[REDACTED]@").replace(PROVIDER_TOKEN, "[TOKEN REDACTED]").replace(JWT_TOKEN, "[TOKEN REDACTED]").slice(0, 2e4);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!isRecord2(value)) return String(value).slice(0, 2e4);
  const sanitized = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeValue(item, depth + 1);
  }
  return sanitized;
}
function sanitizeText(value) {
  return sanitizeValue(value);
}

// src/adapter.ts
function isoTime(milliseconds, fallback) {
  return milliseconds === void 0 ? fallback() : new Date(milliseconds).toISOString();
}
function isTextPart(part) {
  return part.type === "text";
}
function isToolPart(part) {
  return part.type === "tool";
}
function textFromParts(parts) {
  return sanitizeText(
    parts.filter(isTextPart).filter((part) => !part.synthetic && !part.ignored).map((part) => part.text).join("\n").trim()
  );
}
function userMetadata(message) {
  return {
    "opencode.agent": message.agent,
    ...message.system ? { "opencode.system_prompt_present": true } : {}
  };
}
function startTurn(message, parts, credentialScope, now) {
  const userText = new Map(
    parts.filter(isTextPart).filter((part) => !part.synthetic && !part.ignored).map((part) => [part.id, sanitizeText(part.text)])
  );
  return {
    turn: (0, import_tracing.startCodingAgentTurn)({
      harness: "opencode",
      sessionId: message.sessionID,
      turnId: message.id,
      prompt: textFromParts(parts),
      startedAt: isoTime(message.time.created, now),
      model: message.model.modelID,
      provider: message.model.providerID,
      metadata: userMetadata(message)
    }),
    credentialScope,
    assistantText: /* @__PURE__ */ new Map(),
    userText
  };
}
function promptFromUserText(active) {
  return [...active.userText.values()].join("\n").trim();
}
function latestSessionPair(messages, turnId) {
  const user = messages.find(
    (message) => message.info.role === "user" && message.info.id === turnId
  );
  const assistants = messages.filter(
    (message) => message.info.role === "assistant" && message.info.parentID === turnId
  );
  return { user, assistant: assistants.at(-1) };
}
function toolOutput(part) {
  if (part.state.status === "completed") {
    return {
      output: sanitizeValue({
        title: part.state.title,
        output: part.state.output,
        metadata: part.state.metadata
      }),
      endedAt: new Date(part.state.time.end).toISOString()
    };
  }
  if (part.state.status === "error") {
    return {
      error: sanitizeValue(part.state.error),
      endedAt: new Date(part.state.time.end).toISOString()
    };
  }
  return {};
}
function updateFromToolPart(active, part) {
  if (part.state.status === "pending") return;
  active.turn = (0, import_tracing.recordCodingAgentToolStart)(active.turn, {
    toolUseId: part.callID,
    toolName: part.tool,
    input: sanitizeValue(part.state.input),
    startedAt: new Date(part.state.time.start).toISOString()
  });
  const result = toolOutput(part);
  if (!result.endedAt) return;
  active.turn = (0, import_tracing.recordCodingAgentToolResult)(active.turn, {
    toolUseId: part.callID,
    toolName: part.tool,
    input: sanitizeValue(part.state.input),
    output: result.output,
    error: result.error,
    endedAt: result.endedAt
  });
}
function eventSessionId(event) {
  if (!("sessionID" in event.properties)) return void 0;
  return typeof event.properties.sessionID === "string" ? event.properties.sessionID : void 0;
}
function createOpenCodeAdapter(dependencies) {
  const activeBySession = /* @__PURE__ */ new Map();
  const retryBacklog = /* @__PURE__ */ new Set();
  const finalizingTurns = /* @__PURE__ */ new Map();
  const now = dependencies.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const scheduleFlush = dependencies.scheduleFlush ?? (() => void 0);
  const writePending = dependencies.writePending ?? writePendingTurn;
  const warn = dependencies.warn ?? ((message) => console.warn(message));
  async function sessionMessages(sessionId) {
    const result = await dependencies.client.session.messages({
      path: { id: sessionId },
      query: { directory: dependencies.directory }
    });
    return result.data ?? [];
  }
  function finishActive(sessionId, active, options = { startFlush: true }) {
    const existing = finalizingTurns.get(active);
    if (existing) return existing;
    const finalization = (async () => {
      try {
        const messages = await sessionMessages(sessionId);
        const pair = latestSessionPair(messages, active.turn.turnId);
        if (pair.user) {
          active.turn = {
            ...active.turn,
            prompt: textFromParts(pair.user.parts)
          };
        }
        if (pair.assistant?.info.role === "assistant") {
          active.assistant = pair.assistant.info;
          for (const part of pair.assistant.parts) {
            if (isTextPart(part) && !part.synthetic && !part.ignored) {
              active.assistantText.set(part.id, sanitizeText(part.text));
            }
            if (isToolPart(part)) updateFromToolPart(active, part);
          }
        }
        const response = [...active.assistantText.values()].join("\n").trim() || (active.assistant?.error ? `OpenCode turn failed: ${JSON.stringify(sanitizeValue(active.assistant.error))}` : "OpenCode turn completed without a text response");
        const completedAt = active.assistant?.time.completed;
        const createdAt = active.assistant?.time.created;
        const completed = (0, import_tracing.completeCodingAgentTurn)(active.turn, {
          response,
          endedAt: isoTime(completedAt, now),
          model: active.assistant?.modelID,
          provider: active.assistant?.providerID,
          ...createdAt !== void 0 && completedAt !== void 0 ? {
            generationStartedAt: new Date(createdAt).toISOString(),
            generationEndedAt: new Date(completedAt).toISOString()
          } : {}
        });
        await writePending(completed, active.credentialScope, dependencies);
        retryBacklog.delete(active);
        if (activeBySession.get(sessionId) === active) {
          activeBySession.delete(sessionId);
        }
        if (options.startFlush) {
          try {
            scheduleFlush();
          } catch (error) {
            warn(
              `Lemma OpenCode queued the completed turn but could not start delivery: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } catch (error) {
        retryBacklog.add(active);
        if (activeBySession.get(sessionId) === active) {
          activeBySession.delete(sessionId);
        }
        warn(
          `Lemma OpenCode could not queue the completed turn: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        finalizingTurns.delete(active);
      }
    })();
    finalizingTurns.set(active, finalization);
    return finalization;
  }
  function finish(sessionId, options = { startFlush: true }) {
    const active = activeBySession.get(sessionId);
    return active ? finishActive(sessionId, active, options) : Promise.resolve();
  }
  async function retryFailedTurns(options = { startFlush: true }) {
    await Promise.all(
      [...retryBacklog].map(
        (active) => finishActive(active.turn.sessionId, active, options)
      )
    );
  }
  async function beginTurn(message, parts) {
    await retryFailedTurns();
    const existing = activeBySession.get(message.sessionID);
    if (existing && existing.turn.turnId !== message.id) {
      await finishActive(message.sessionID, existing);
    }
    const credentials = await readCredentials(dependencies);
    if (!credentials) {
      warn(
        "Lemma OpenCode skipped tracing because no scoped credential is configured."
      );
      return;
    }
    activeBySession.set(
      message.sessionID,
      startTurn(
        message,
        parts,
        {
          apiUrl: credentials.apiUrl,
          projectId: credentials.projectId,
          credentialId: credentials.credentialId
        },
        now
      )
    );
  }
  return {
    async chatMessage(message, parts) {
      await beginTurn(message, parts);
    },
    beforeTool(input, args) {
      const active = activeBySession.get(input.sessionID);
      if (!active) return;
      active.turn = (0, import_tracing.recordCodingAgentToolStart)(active.turn, {
        toolUseId: input.callID,
        toolName: input.tool,
        input: sanitizeValue(args),
        startedAt: now()
      });
    },
    afterTool(input, output) {
      const active = activeBySession.get(input.sessionID);
      if (!active) return;
      active.turn = (0, import_tracing.recordCodingAgentToolResult)(active.turn, {
        toolUseId: input.callID,
        toolName: input.tool,
        input: sanitizeValue(input.args),
        output: sanitizeValue(output),
        endedAt: now()
      });
    },
    async event(event) {
      const sessionId = eventSessionId(event);
      if (event.type === "message.updated") {
        const message = event.properties.info;
        if (message.role === "user") {
          const existing = activeBySession.get(message.sessionID);
          if (!existing || existing.turn.turnId !== message.id) {
            await beginTurn(message, []);
          }
          return;
        }
        const active = activeBySession.get(message.sessionID);
        if (active && message.parentID === active.turn.turnId) {
          active.assistant = message;
        }
        return;
      }
      if (event.type === "message.part.updated") {
        const part = event.properties.part;
        const active = activeBySession.get(part.sessionID);
        if (!active) return;
        if (part.messageID === active.turn.turnId && isTextPart(part)) {
          if (!part.synthetic && !part.ignored) {
            active.userText.set(part.id, sanitizeText(part.text));
            active.turn = {
              ...active.turn,
              prompt: promptFromUserText(active)
            };
          }
          return;
        }
        if (active.assistant && part.messageID !== active.assistant.id) return;
        if (isTextPart(part) && !part.synthetic && !part.ignored) {
          active.assistantText.set(part.id, sanitizeText(part.text));
        } else if (isToolPart(part)) {
          updateFromToolPart(active, part);
        }
        return;
      }
      if (event.type === "session.idle" && sessionId) {
        await finish(sessionId);
      }
    },
    async dispose() {
      await Promise.all(
        [...activeBySession.keys()].map(
          (sessionId) => finish(sessionId, { startFlush: false })
        )
      );
      await retryFailedTurns({ startFlush: false });
      if (retryBacklog.size > 0) {
        throw new Error(
          `Lemma OpenCode could not persist ${retryBacklog.size} completed turn${retryBacklog.size === 1 ? "" : "s"} during shutdown`
        );
      }
    },
    pendingTurnCount() {
      return activeBySession.size + retryBacklog.size;
    }
  };
}

// src/flush.ts
var import_tracing2 = __toESM(require_dist(), 1);
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  mkdir as mkdir3,
  readFile as readFile2,
  readdir,
  rename as rename3,
  rm,
  stat,
  unlink as unlink2,
  writeFile as writeFile3
} from "node:fs/promises";
import { join as join3 } from "node:path";

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
        reject(new Error("Lemma OpenCode trace delivery timed out"));
      }, timeoutMilliseconds);
    });
    const requestAndBody = (async () => {
      const response = await fetchImplementation(request, { ...init, signal });
      if (response.ok || !response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    })();
    try {
      return await Promise.race([requestAndBody, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

// src/flush.ts
var FLUSH_LOCK_STALE_MS = 3e4;
var FLUSH_LOCK_OWNER_FILE = "owner.json";
var DEFAULT_FLUSH_TIMEOUT_MS = 1e4;
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readLockOwner(path) {
  try {
    const value = JSON.parse(await readFile2(path, "utf8"));
    if (isRecord3(value) && typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0 && typeof value.id === "string" && value.id.length > 0) {
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
async function acquireFlushLock(dataDir) {
  await mkdir3(dataDir, { recursive: true, mode: 448 });
  const lockPath = join3(dataDir, "flush.lock");
  const ownerPath = join3(lockPath, FLUSH_LOCK_OWNER_FILE);
  const owner = { pid: process.pid, id: randomUUID2() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir3(lockPath, { mode: 448 });
      await writeFile3(ownerPath, `${JSON.stringify(owner)}
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
      const quarantinePath = join3(dataDir, `flush.lock.stale-${randomUUID2()}`);
      try {
        await rename3(lockPath, quarantinePath);
      } catch (claimError) {
        if (claimError.code === "ENOENT") {
          return null;
        }
        throw claimError;
      }
      await rm(quarantinePath, { recursive: true, force: true });
    }
  }
  return null;
}
async function pendingEntryNames(dataDir) {
  return readdir(join3(dataDir, "pending")).then((entries) => entries.filter((name) => name.endsWith(".json")).sort()).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}
async function flushPendingTurns(options = {}) {
  const dataDir = resolveDataDir(options);
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? now() + (options.timeoutMilliseconds ?? DEFAULT_FLUSH_TIMEOUT_MS);
  let sent = 0;
  const attemptedEntries = /* @__PURE__ */ new Set();
  while (true) {
    const releaseLock = await acquireFlushLock(dataDir);
    if (!releaseLock) return sent;
    try {
      const credentials = await readCredentials({ ...options, dataDir });
      if (!credentials) throw new Error(LEMMA_OPENCODE_CREDENTIALS_HELP);
      const pendingDir = join3(dataDir, "pending");
      for (const entry of (await pendingEntryNames(dataDir)).filter(
        (name) => !attemptedEntries.has(name)
      )) {
        const remainingMilliseconds = deadline - now();
        if (remainingMilliseconds <= 0) return sent;
        attemptedEntries.add(entry);
        const path = join3(pendingDir, entry);
        try {
          const pending = JSON.parse(await readFile2(path, "utf8"));
          if (!isPendingOpenCodeTurn(pending)) {
            throw new Error("invalid pending turn");
          }
          if (pending.apiUrl !== credentials.apiUrl || pending.projectId !== credentials.projectId) {
            throw new Error(
              "pending turn belongs to a different scoped credential"
            );
          }
          const trace = (0, import_tracing2.codingAgentTurnTrace)(pending.turn);
          await new import_tracing2.Lemma({
            apiKey: credentials.accessToken,
            projectId: credentials.projectId,
            baseUrl: credentials.apiUrl,
            fetch: createDeliveryFetch(
              options.fetch,
              Math.min(DELIVERY_TIMEOUT_MS, remainingMilliseconds)
            )
          }).ingest(trace.context, {
            startedAt: new Date(trace.startedAt),
            endedAt: new Date(trace.endedAt)
          });
          await unlink2(path);
          sent += 1;
        } catch {
          options.warn?.(
            `Lemma OpenCode retained a trace for retry (${entry}).`
          );
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

// src/plugin-entry.ts
var LemmaPlugin = async ({ client, directory }) => {
  const warn = (message) => console.warn(message);
  let disposing = false;
  let flushRequested = false;
  let flushPromise;
  const runFlush = (deadline) => {
    flushRequested = true;
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      do {
        flushRequested = false;
        await flushPendingTurns({ warn, deadline });
      } while (flushRequested && !disposing);
    })().catch((error) => {
      console.warn(
        `Lemma OpenCode flush failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }).finally(() => {
      flushPromise = void 0;
      if (flushRequested && !disposing) void runFlush();
    });
    return flushPromise;
  };
  const scheduleFlush = () => {
    void runFlush();
  };
  const adapter = createOpenCodeAdapter({
    client,
    directory,
    scheduleFlush
  });
  scheduleFlush();
  return {
    "chat.message": async (_input, output) => {
      await adapter.chatMessage(output.message, output.parts);
    },
    "tool.execute.before": async (input, output) => {
      adapter.beforeTool(input, output.args);
    },
    "tool.execute.after": async (input, output) => {
      adapter.afterTool(input, output);
    },
    event: async ({ event }) => {
      await adapter.event(event);
    },
    dispose: async () => {
      disposing = true;
      const deadline = Date.now() + DEFAULT_FLUSH_TIMEOUT_MS;
      let disposalError;
      try {
        await adapter.dispose();
      } catch (error) {
        disposalError = error;
      }
      await flushPromise;
      if (Date.now() < deadline) await runFlush(deadline);
      if (disposalError) throw disposalError;
    }
  };
};
export {
  LemmaPlugin
};
