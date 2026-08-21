const SENSITIVE_KEYS = new Set([
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
  "credential",
  "private_key",
  "aws_secret_access_key",
  "connection_string",
  "database_url",
  "database_uri",
  "db_url",
  "stripe_secret_key",
]);
const SENSITIVE_KEY_SUFFIXES = [
  "_authorization",
  "_cookie",
  "_password",
  "_passwd",
  "_secret",
  "_token",
  "_api_key",
  "_apikey",
  "_credential",
  "_private_key",
  "_access_key",
  "_secret_key",
  "_connection_string",
  "_database_url",
  "_database_uri",
];

const SECRET_ASSIGNMENT =
  /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(?!["']?\[REDACTED\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)/g;
const AUTHORIZATION_HEADER =
  /(\bAuthorization\s*:\s*)(?:Basic|Bearer|Digest|Negotiate|AWS4-HMAC-SHA256)\s+[^\r\n]+/gi;
const JSON_COOKIE_VALUE =
  /("(?:Cookie|Set-Cookie)"\s*:\s*)(?:\[(?:\s*"(?:\\.|[^"\\])*"\s*,?)*\s*\]|"(?:\\.|[^"\\])*")/gi;
const COOKIE_HEADER = /(\b(?:Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi;
const AUTHORIZATION_TOKEN =
  /\b(?:Basic|Bearer)\s+(?=[^\s,;}\]\r\n]{8,})(?=[^\s,;}\]\r\n]*[0-9_~+/-])[^\s,;}\]\r\n]+/gi;
const PEM_BLOCK =
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE)-----|$)/g;
const PROVIDER_TOKEN =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|lemma_[A-Za-z0-9_-]{16,})\b/g;
const JWT_TOKEN =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const CREDENTIAL_BEARING_URL =
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replaceAll(/[-.]/g, "_");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || ["boolean", "number"].includes(typeof value)) {
    return value;
  }
  if (typeof value === "string") {
    return value
      .replace(PEM_BLOCK, "[PEM REDACTED]")
      .replace(AUTHORIZATION_HEADER, "$1[REDACTED]")
      .replace(JSON_COOKIE_VALUE, '$1"[REDACTED]"')
      .replace(COOKIE_HEADER, "$1[REDACTED]")
      .replace(AUTHORIZATION_TOKEN, "[REDACTED]")
      .replace(
        SECRET_ASSIGNMENT,
        (match, opening: string, key: string, separator: string) =>
          isSensitiveKey(key)
            ? `${opening}${key}${separator}[REDACTED]`
            : match,
      )
      .replace(CREDENTIAL_BEARING_URL, "$1[REDACTED]@")
      .replace(PROVIDER_TOKEN, "[TOKEN REDACTED]")
      .replace(JWT_TOKEN, "[TOKEN REDACTED]")
      .slice(0, 20_000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!isRecord(value)) return String(value).slice(0, 20_000);
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeValue(item, depth + 1);
  }
  return sanitized;
}

export function sanitizeText(value: string): string {
  return sanitizeValue(value) as string;
}
