/** API keys are a prefix plus hex; anything else is refused before it reaches a file. */
export const API_KEY_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The line ending a file already uses, so an edit keeps it. */
export function lineEnding(contents: string): string {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

/** `A and B`, or `A, B, and C`. */
export function listed(items: readonly string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
