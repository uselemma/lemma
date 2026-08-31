/**
 * Pick a canonical model identity string from provider / framework payloads.
 *
 * Looks at invocation, response, and `response_metadata` aliases. Does not
 * invent a name when none is present.
 */

const MODEL_KEYS = [
  "model",
  "model_name",
  "modelName",
  "model_id",
  "modelId",
  "ls_model_name",
] as const;

const NESTED_CONTAINERS = [
  "response_metadata",
  "responseMetadata",
  "llm_output",
  "llmOutput",
  "generationInfo",
  "generation_info",
  "kwargs",
  "additional_kwargs",
  "message",
  "response",
] as const;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Extract a model id from a string, invocation dict, response, or
 * `response_metadata` wrapper. Recurses only into known nested containers.
 */
export function pickModelIdentity(raw: unknown): string | undefined {
  const fromString = asNonEmptyString(raw);
  if (fromString) return fromString;

  const record = asRecord(raw);
  if (!record) return undefined;

  for (const key of MODEL_KEYS) {
    const value = record[key];
    const asString = asNonEmptyString(value);
    if (asString) return asString;
    if (value && typeof value === "object") {
      const nested = pickModelIdentity(value);
      if (nested) return nested;
    }
  }

  for (const key of NESTED_CONTAINERS) {
    const nested = pickModelIdentity(record[key]);
    if (nested) return nested;
  }

  return undefined;
}

/**
 * Walk an LLMResult-shaped payload (LangChain generations, plus invocation /
 * llmOutput wrappers) for a model id.
 */
export function pickGenerationModelIdentity(raw: unknown): string | undefined {
  const direct = pickModelIdentity(raw);
  if (direct) return direct;

  const record = asRecord(raw);
  if (!record) return undefined;

  const generations = record.generations;
  if (!Array.isArray(generations)) return undefined;

  for (const group of generations) {
    if (!Array.isArray(group)) {
      const fromGroup = pickModelIdentity(group);
      if (fromGroup) return fromGroup;
      continue;
    }
    for (const item of group) {
      const fromItem = pickModelIdentity(item);
      if (fromItem) return fromItem;
    }
  }

  return undefined;
}
