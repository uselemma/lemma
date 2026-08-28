/**
 * Detect MCP-style / framework tool results that encode failure in the payload
 * instead of throwing. Protocol flags (`isError: true`, Mastra `error: true`)
 * and application-level `{ error: "..." }` / `structuredContent.error` strings
 * are recorded as `error` (with no `output`). Returns null for a normal
 * success payload.
 */
export function toolResultError(output: unknown): string | null {
  const record = asResultRecord(output);
  if (!record) return null;

  if (isFlaggedFailure(record)) {
    const text = contentText(record.content);
    if (text) return text;
    const flaggedError = nonEmptyString(record.error);
    if (flaggedError) return flaggedError;
    const message = nonEmptyString(record.message);
    if (message) return message;
    try {
      return JSON.stringify(record);
    } catch {
      return "Tool returned an error result";
    }
  }

  return encodedPayloadError(record);
}

function isFlaggedFailure(record: Record<string, unknown>): boolean {
  return (
    record.isError === true ||
    record.is_error === true ||
    record.error === true
  );
}

function encodedPayloadError(record: Record<string, unknown>): string | null {
  const direct = nonEmptyString(record.error);
  if (direct) return direct;

  const structured = asResultRecord(record.structuredContent);
  const nested = structured ? nonEmptyString(structured.error) : null;
  if (nested) return nested;

  const text = contentText(record.content);
  if (!text) return null;
  const parsed = asResultRecord(text);
  return parsed ? nonEmptyString(parsed.error) : null;
}

function contentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const textValue = (part as { text?: unknown }).text;
      return typeof textValue === "string" ? textValue : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
