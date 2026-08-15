export const RELEASE_MAX_LENGTH = 200;

const CONTROL_CHARS = /[\n\t\r]/;

/**
 * Trim; drop empty; reject newlines/tabs/CR; cap at 200 chars.
 * Invalid input is unreleased (`undefined`). Does not guess a git SHA.
 */
export function normalizeRelease(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > RELEASE_MAX_LENGTH) return undefined;
  if (CONTROL_CHARS.test(trimmed)) return undefined;
  return trimmed;
}
