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

  return safeText(error) || null;
}

/**
 * Same normalization for code paths that already know the run failed and need
 * a message to record — falls back to a generic one rather than dropping the
 * failure.
 */
export function describeError(error: unknown): string {
  return errorMessage(error) ?? GENERIC_ERROR_NAME;
}

/**
 * Normalize a reported failure, treating presence rather than truthiness as the
 * signal: `fail("   ")` or an error object with nothing readable in it still
 * failed, and only a nullish value means no failure happened.
 */
export function failureMessage(error: unknown): string | null {
  return error == null ? null : describeError(error);
}

/** Subclasses that never set `name` still report the useful constructor name. */
function errorClassName(error: Error): string {
  const name = typeof error.name === "string" ? error.name : undefined;
  if (name && name !== GENERIC_ERROR_NAME) return name;
  const constructorName = error.constructor?.name;
  return (
    (typeof constructorName === "string" ? constructorName : undefined) ||
    name ||
    GENERIC_ERROR_NAME
  );
}

/**
 * Keep the class name when it carries information: `TypeError: x is not a
 * function` stays qualified, a plain `Error` does not repeat itself.
 */
function qualify(name: string | undefined, message: unknown): string {
  const trimmedName = name?.trim();
  const trimmedMessage = messageText(message);
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

/**
 * `Error.message` and error-like `message` fields are typed as strings, but
 * nothing enforces that at runtime — a subclass field declaration alone leaves
 * `message` undefined, and frameworks sometimes assign a payload to it. Coerce
 * instead of trusting the type, or the SDK throws while recording a failure.
 */
function messageText(message: unknown): string {
  if (typeof message === "string") return message.trim();
  if (message == null) return "";
  if (typeof message === "object") {
    const text = stringifyObject(message);
    // Nothing readable in the payload — let the class name speak instead.
    return text === GENERIC_ERROR_NAME ? "" : text;
  }
  return safeText(message);
}

function stringifyObject(error: object): string {
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
    // Circular or non-serializable payload — fall through to String().
  }
  const text = safeText(error);
  return text && text !== "[object Object]" ? text : GENERIC_ERROR_NAME;
}

/** String coercion that tolerates hostile `toString` / `Symbol.toPrimitive`. */
function safeText(value: unknown): string {
  try {
    return String(value).trim();
  } catch {
    return "";
  }
}

const GENERIC_ERROR_NAME = "Error";
