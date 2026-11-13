import { normalizeTokenUsage, type TokenUsage } from "./usage";

type SpanData = {
  type: string;
  [key: string]: unknown;
};

const RESPONSE_SETTING_KEYS = [
  "temperature",
  "top_p",
  "max_output_tokens",
  "max_tool_calls",
  "tool_choice",
  "parallel_tool_calls",
  "truncation",
  "reasoning",
  "text",
  "service_tier",
] as const;

const HISTORY_ITEM_ROLES: Record<string, string> = {
  function_call: "assistant",
  reasoning: "assistant",
  function_call_result: "tool",
  function_call_output: "tool",
};

/**
 * A response object as a plain record. Live SDK objects that serialize
 * themselves (`toJSON`) are read through it; anything else is copied as is.
 */
export function asResponseRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") {
    try {
      const dumped: unknown = toJSON.call(value);
      if (dumped && typeof dumped === "object" && !Array.isArray(dumped)) {
        return { ...(dumped as Record<string, unknown>) };
      }
    } catch {
      // Fall through to the object's own fields.
    }
  }
  return { ...(value as Record<string, unknown>) };
}

/** The Responses object on span data, whether the SDK used `response` or `_response`. */
export function responseRecord(
  data: SpanData,
): Record<string, unknown> | undefined {
  return asResponseRecord(data["response"] ?? data["_response"]);
}

/** Message bodies a response span already stores as the span input and output. */
const RESPONSE_BODY_KEYS = [
  "output",
  "output_text",
  "instructions",
  "input",
] as const;

/** Span data for the `openai.agents.span_data` attribute, without prompt bodies. */
export function spanDataForAttribute<T extends SpanData>(data: T): T {
  const copy: SpanData = { ...data };
  delete copy._input;
  if (copy.type === "response") {
    for (const key of RESPONSE_BODY_KEYS) delete copy[key];
  }
  for (const key of ["response", "_response"] as const) {
    if (!(key in copy)) continue;
    const response = asResponseRecord(copy[key]);
    if (!response) continue;
    for (const bodyKey of RESPONSE_BODY_KEYS) delete response[bodyKey];
    copy[key] = response;
  }
  return copy as T;
}

function instructionsText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isSameSystemMessage(message: unknown, instructions: string): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.role === "system" && record.content === instructions;
}

function withHistoryRole(message: unknown): unknown {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return message;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.role === "string" && record.role) return message;
  const role =
    typeof record.type === "string"
      ? HISTORY_ITEM_ROLES[record.type]
      : undefined;
  if (!role) return message;
  return { ...record, role };
}

function historyMessages(messages: unknown[]): unknown[] {
  return messages.map(withHistoryRole);
}

function inputMessages(
  input: unknown,
  response: Record<string, unknown> | undefined,
): unknown[] | undefined {
  const instructions = instructionsText(response?.instructions);
  const messages = Array.isArray(input) ? input : undefined;
  if (!instructions) return messages ? historyMessages(messages) : undefined;
  if (messages?.some((message) => isSameSystemMessage(message, instructions))) {
    return historyMessages(messages);
  }
  const system = { role: "system", content: instructions };
  if (!messages) {
    if (typeof input === "string" && input) {
      return historyMessages([system, { role: "user", content: input }]);
    }
    return historyMessages([system]);
  }
  return historyMessages([system, ...messages]);
}

function generationTools(
  data: SpanData,
  response: Record<string, unknown> | undefined,
): unknown {
  if (response && response.tools != null) return response.tools;
  if (data["tools"] != null) return data["tools"];
  return undefined;
}

function invocationParameters(
  data: SpanData,
  response: Record<string, unknown> | undefined,
): unknown {
  if (data["model_config"] != null) return data["model_config"];
  if (!response) return undefined;
  const settings: Record<string, unknown> = {};
  for (const key of RESPONSE_SETTING_KEYS) {
    const value = response[key];
    if (value != null) settings[key] = value;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

function outputMessages(
  data: SpanData,
  response: Record<string, unknown> | undefined,
): unknown[] | undefined {
  if (data.type !== "generation" && data.type !== "response") return undefined;
  if (data.type === "generation" && Array.isArray(data["output"])) {
    return data["output"] as unknown[];
  }
  if (response && Array.isArray(response.output)) {
    return response.output as unknown[];
  }
  if (Array.isArray(data["output"])) return data["output"] as unknown[];
  return undefined;
}

function usageFor(
  data: SpanData,
  response: Record<string, unknown> | undefined,
): TokenUsage | undefined {
  const direct = normalizeTokenUsage(data["usage"]);
  if (direct) return direct;
  if (!response) return undefined;
  return normalizeTokenUsage(response.usage);
}

export type GenerationFields = {
  llmInputMessages?: unknown[];
  llmInvocationParameters?: unknown;
  llmTools?: unknown;
};

export type GenerationSnapshot = {
  response: Record<string, unknown> | undefined;
  fields: GenerationFields;
  outputMessages?: unknown[];
  usage?: TokenUsage;
};

/** One read of the response object for messages, tools, settings, and usage. */
export function generationSnapshot(
  data: SpanData,
  input: unknown,
): GenerationSnapshot {
  const response = responseRecord(data);
  const messages = inputMessages(input, response);
  const parameters = invocationParameters(data, response);
  const tools = generationTools(data, response);
  return {
    response,
    fields: {
      ...(messages ? { llmInputMessages: messages } : {}),
      ...(parameters !== undefined
        ? { llmInvocationParameters: parameters }
        : {}),
      ...(tools !== undefined ? { llmTools: tools } : {}),
    },
    outputMessages: outputMessages(data, response),
    usage: usageFor(data, response),
  };
}

/**
 * Reply text from the normalized response. A value that is not a mapping
 * stays the span output, which is how non-object SDK payloads were recorded.
 */
export function replyFromResponse(
  data: SpanData,
  response: Record<string, unknown> | undefined,
  textFromList: (output: unknown) => unknown,
): unknown {
  if (!response) {
    const raw = data["response"] ?? data["_response"];
    if (raw == null) return textFromList(data["output"]);
    return raw;
  }
  if (typeof response.output_text === "string") return response.output_text;
  if (Array.isArray(response.output)) return textFromList(response.output);
  return response;
}
