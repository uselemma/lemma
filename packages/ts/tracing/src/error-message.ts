/**
 * Normalize anything that represents a failure into a human-readable message.
 *
 * Returns null only when there is no failure at all — never an empty string.
 * Callers derive `status: "ERROR"` and root-trace failure from the presence of
 * a message, so an empty one would silently downgrade a failed run to a
 * successful one.
 */
export function errorMessage(error: unknown): string | null {
  if (error == null) return null;

  if (error instanceof Error) {
    return qualify(errorClassName(error), error.message);
  }

  if (typeof error === "string") {
    return error.trim() || null;
  }

  if (typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown };
    if (typeof record.message === "string") {
      return qualify(
        typeof record.name === "string" ? record.name : undefined,
        record.message,
      );
    }
    return stringifyObject(error);
  }

  return String(error).trim() || null;
}

/**
 * Same normalization for code paths that already know the run failed and need
 * a message to record — falls back to a generic one rather than dropping the
 * failure.
 */
export function describeError(error: unknown): string {
  return errorMessage(error) ?? GENERIC_ERROR_NAME;
}

/** Subclasses that never set `name` still report the useful constructor name. */
function errorClassName(error: Error): string {
  if (error.name && error.name !== GENERIC_ERROR_NAME) return error.name;
  return error.constructor?.name || error.name || GENERIC_ERROR_NAME;
}

/**
 * Keep the class name when it carries information: `TypeError: x is not a
 * function` stays qualified, a plain `Error` does not repeat itself.
 */
function qualify(name: string | undefined, message: string): string {
  const trimmedName = name?.trim();
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return trimmedName || GENERIC_ERROR_NAME;
  if (
    !trimmedName ||
    trimmedName === GENERIC_ERROR_NAME ||
    trimmedMessage.startsWith(`${trimmedName}:`)
  ) {
    return trimmedMessage;
  }
  return `${trimmedName}: ${trimmedMessage}`;
}

function stringifyObject(error: object): string {
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
    // Circular or non-serializable payload — fall through to String().
  }
  const text = String(error).trim();
  return text && text !== "[object Object]" ? text : GENERIC_ERROR_NAME;
}

const GENERIC_ERROR_NAME = "Error";
