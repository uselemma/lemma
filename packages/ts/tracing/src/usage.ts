/**
 * Token usage for a generation span (TypeScript DX — camelCase).
 *
 * Wire format uses snake_case (`input_tokens`, …). Omit fields the provider
 * did not supply; never invent zeros. Explicit zeros are emitted so Analytics
 * can distinguish healthy zero from missing instrumentation.
 */
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningOutputTokens?: number;
};

/** Ingest JSON top-level `usage` object (snake_case). */
export type WireTokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_output_tokens?: number;
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = asFiniteNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Normalize provider-specific usage shapes into TokenUsage.
 *
 * Accepts camelCase / snake_case / prompt+completion aliases, OpenAI nested
 * details, Anthropic cache fields, Vercel AI SDK, LangChain tokenUsage /
 * usage_metadata, and Mastra when input/output are distinguishable.
 *
 * `totalTokens` alone is not enough — do not invent an input/output split.
 * Returns undefined when nothing usable is present.
 */
export function normalizeTokenUsage(raw: unknown): TokenUsage | undefined {
  if (raw == null) return undefined;

  let source = asRecord(raw);
  if (!source) return undefined;

  // LangChain / wrappers sometimes nest under tokenUsage / usage_metadata / usage.
  const nested =
    asRecord(source.tokenUsage) ??
    asRecord(source.token_usage) ??
    asRecord(source.usage_metadata) ??
    asRecord(source.usage);
  // Prefer nested when the outer object only wraps it (no top-level token fields).
  if (nested) {
    const outerHasTokens =
      pickNumber(source, [
        "inputTokens",
        "input_tokens",
        "promptTokens",
        "prompt_tokens",
        "outputTokens",
        "output_tokens",
        "completionTokens",
        "completion_tokens",
      ]) !== undefined;
    if (!outerHasTokens) source = nested;
  }

  const inputTokens = pickNumber(source, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = pickNumber(source, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);

  // Nested detail containers across providers / SDKs:
  // - Chat Completions: prompt_tokens_details / completion_tokens_details
  // - Responses / OpenAI Agents: input_tokens_details / output_tokens_details
  // - AI SDK 7: inputTokenDetails / outputTokenDetails
  const promptDetails =
    asRecord(source.prompt_tokens_details) ??
    asRecord(source.promptTokensDetails) ??
    asRecord(source.input_tokens_details) ??
    asRecord(source.inputTokensDetails) ??
    asRecord(source.input_token_details) ??
    asRecord(source.inputTokenDetails);
  const completionDetails =
    asRecord(source.completion_tokens_details) ??
    asRecord(source.completionTokensDetails) ??
    asRecord(source.output_tokens_details) ??
    asRecord(source.outputTokensDetails) ??
    asRecord(source.output_token_details) ??
    asRecord(source.outputTokenDetails);

  let cacheReadInputTokens = pickNumber(source, [
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedInputTokens",
    "cached_input_tokens",
    "cache_read",
  ]);
  if (cacheReadInputTokens === undefined && promptDetails) {
    cacheReadInputTokens = pickNumber(promptDetails, [
      "cached_tokens",
      "cachedTokens",
      "cache_read",
      "cacheRead",
      // AI SDK 7 LanguageModelUsage.inputTokenDetails
      "cacheReadTokens",
      "cache_read_tokens",
    ]);
  }

  let cacheCreationInputTokens = pickNumber(source, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cache_creation",
    "cacheWriteTokens",
    "cache_write_tokens",
  ]);
  if (cacheCreationInputTokens === undefined && promptDetails) {
    cacheCreationInputTokens = pickNumber(promptDetails, [
      "cache_creation",
      "cacheCreation",
      "cache_write",
      "cacheWrite",
      // OpenAI Responses / Agents + AI SDK 7
      "cache_write_tokens",
      "cacheWriteTokens",
    ]);
  }

  let reasoningOutputTokens = pickNumber(source, [
    "reasoningOutputTokens",
    "reasoning_output_tokens",
    "reasoningTokens",
    "reasoning_tokens",
  ]);
  if (reasoningOutputTokens === undefined && completionDetails) {
    reasoningOutputTokens = pickNumber(completionDetails, [
      "reasoning_tokens",
      "reasoningTokens",
      "reasoning",
    ]);
  }

  const usage: TokenUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (cacheReadInputTokens !== undefined) {
    usage.cacheReadInputTokens = cacheReadInputTokens;
  }
  if (cacheCreationInputTokens !== undefined) {
    usage.cacheCreationInputTokens = cacheCreationInputTokens;
  }
  if (reasoningOutputTokens !== undefined) {
    usage.reasoningOutputTokens = reasoningOutputTokens;
  }

  // totalTokens alone is not enough to populate input/output — omit rather
  // than invent a split (e.g. Mastra `{ totalTokens }` only).
  if (Object.keys(usage).length === 0) return undefined;
  return usage;
}

/** Operation result shapes that may carry token usage after a framework event. */
export type OperationUsageResult = {
  usage?: unknown;
  totalUsage?: unknown;
  steps?: ReadonlyArray<{ usage?: unknown }>;
  usage_metadata?: unknown;
  response_metadata?: unknown;
  rawResponses?: ReadonlyArray<{ usage?: unknown }>;
};

function asUsageResult(raw: unknown): OperationUsageResult | undefined {
  return asRecord(raw);
}

function resultStepUsages(
  result: OperationUsageResult,
): Array<TokenUsage | undefined> {
  if (Array.isArray(result.steps)) {
    return result.steps.map((step) => normalizeTokenUsage(step?.usage));
  }
  if (Array.isArray(result.rawResponses)) {
    return result.rawResponses.map((response) =>
      normalizeTokenUsage(response?.usage),
    );
  }
  return [];
}

function resultTotalUsage(result: OperationUsageResult): TokenUsage | undefined {
  return (
    normalizeTokenUsage(result.totalUsage) ??
    normalizeTokenUsage(result.usage) ??
    normalizeTokenUsage(result.usage_metadata) ??
    normalizeTokenUsage(result.response_metadata) ??
    normalizeTokenUsage(result)
  );
}

function spanHasUsage(span: {
  usage?: WireTokenUsage;
}): boolean {
  return span.usage != null && Object.keys(span.usage).length > 0;
}

function stampSpanUsage(
  span: {
    usage?: WireTokenUsage;
    attributes?: Record<string, unknown>;
  },
  usage: TokenUsage | undefined,
): boolean {
  if (!usage || spanHasUsage(span)) return false;
  const wire = toWireTokenUsage(usage);
  if (!wire) return false;
  span.usage = wire;
  span.attributes = {
    ...span.attributes,
    ...tokenUsageAttributes(usage),
  };
  return true;
}

/**
 * Copy operation-result usage onto existing generation spans.
 *
 * One generation → `totalUsage` / `usage` so a multi-step call is not
 * undercounted. Several generations → per-step (or `rawResponses`) usage in
 * order. Never write the same total onto every span.
 *
 * Spans that already have usage are left alone. Returns the number of spans
 * that received usage.
 */
export function attachResultUsage(
  generations: Array<{
    usage?: WireTokenUsage;
    attributes?: Record<string, unknown>;
  }>,
  result: unknown,
): number {
  if (generations.length === 0) return 0;
  const parsed = asUsageResult(result);
  if (!parsed) return 0;

  const steps = resultStepUsages(parsed);
  const total = resultTotalUsage(parsed);

  if (generations.length === 1) {
    return stampSpanUsage(generations[0]!, total ?? steps[0]) ? 1 : 0;
  }

  let stamped = 0;
  for (let i = 0; i < generations.length; i += 1) {
    if (stampSpanUsage(generations[i]!, steps[i])) stamped += 1;
  }
  if (stamped === 0 && total) {
    return stampSpanUsage(generations[0]!, total) ? 1 : 0;
  }
  return stamped;
}

/** Convert TokenUsage to the ingest wire object. Omits undefined fields. */
export function toWireTokenUsage(
  usage: TokenUsage | undefined,
): WireTokenUsage | undefined {
  if (!usage) return undefined;
  const wire: WireTokenUsage = {};
  if (usage.inputTokens !== undefined) wire.input_tokens = usage.inputTokens;
  if (usage.outputTokens !== undefined) wire.output_tokens = usage.outputTokens;
  if (usage.cacheReadInputTokens !== undefined) {
    wire.cache_read_input_tokens = usage.cacheReadInputTokens;
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    wire.cache_creation_input_tokens = usage.cacheCreationInputTokens;
  }
  if (usage.reasoningOutputTokens !== undefined) {
    wire.reasoning_output_tokens = usage.reasoningOutputTokens;
  }
  return Object.keys(wire).length > 0 ? wire : undefined;
}

/** Flatten TokenUsage into GenAI + OpenInference attribute keys. */
export function tokenUsageAttributes(
  usage: TokenUsage | undefined,
): Record<string, number> {
  if (!usage) return {};
  const attributes: Record<string, number> = {};
  if (usage.inputTokens !== undefined) {
    attributes["gen_ai.usage.input_tokens"] = usage.inputTokens;
    attributes["llm.token_count.prompt"] = usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    attributes["gen_ai.usage.output_tokens"] = usage.outputTokens;
    attributes["llm.token_count.completion"] = usage.outputTokens;
  }
  if (usage.cacheReadInputTokens !== undefined) {
    attributes["gen_ai.usage.cache_read.input_tokens"] =
      usage.cacheReadInputTokens;
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    attributes["gen_ai.usage.cache_creation.input_tokens"] =
      usage.cacheCreationInputTokens;
  }
  if (usage.reasoningOutputTokens !== undefined) {
    attributes["gen_ai.usage.reasoning.output_tokens"] =
      usage.reasoningOutputTokens;
  }
  return attributes;
}
