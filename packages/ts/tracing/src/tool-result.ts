/**
 * Detect MCP-style / framework tool results that encode failure in the payload
 * (e.g. `{ isError: true, content: [...] }`) instead of throwing.
 * Returns an error message when the result should be recorded as `error`
 * (with no `output`), or null when it is a normal success payload.
 */
export function toolResultError(output: unknown): string | null {
  const record = asResultRecord(output);
  if (!record) return null;
  if (record.isError !== true && record.is_error !== true) return null;

  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const textValue = (part as { text?: unknown }).text;
        return typeof textValue === "string" ? textValue : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
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

function asResultRecord(output: unknown): Record<string, unknown> | null {
  if (output == null) return null;
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return null;
}
