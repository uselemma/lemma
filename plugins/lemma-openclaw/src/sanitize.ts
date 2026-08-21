const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
];

const SECRET_ASSIGNMENT = new RegExp(
  String.raw`(["']?(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)["']?\s*[:=]\s*)(?:Bearer\s+[^\s,;}\]]+|"[^"]*"|'[^']*'|[^\s,;}\]]+)`,
  "gi",
);
const BEARER_TOKEN = /\bBearer\s+[^\s,;}\]]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  if (typeof value === "string") {
    return value
      .slice(0, 20_000)
      .replace(SECRET_ASSIGNMENT, "$1[REDACTED]")
      .replace(BEARER_TOKEN, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!isRecord(value)) return String(value).slice(0, 20_000);
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    const normalized = key.toLowerCase().replaceAll(/[-.]/g, "_");
    if (SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))) continue;
    sanitized[key] = sanitizeValue(item, depth + 1);
  }
  return sanitized;
}

export function sanitizeText(value: string): string {
  return sanitizeValue(value) as string;
}

function textParts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!isRecord(item)) return [];
    for (const key of ["text", "output_text", "content"]) {
      if (typeof item[key] === "string") return [item[key]];
    }
    return [];
  });
}

export function lastAssistantText(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    const text = textParts(message.content).join("\n").trim();
    if (text) return text;
  }
  return "";
}
