/**
 * The coding-agent ids the setup handshake accepts. The API validates the
 * harness against this exact list and rejects any other value, so it must
 * match the platform's setup harness ids. `other` covers any coding agent
 * without its own id.
 */
export const HARNESS_IDS = [
  "codex",
  "claude-code",
  "cursor",
  "pi",
  "hermes",
  "openclaw",
  "opencode",
  "other",
] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}
