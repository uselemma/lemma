const SENSITIVE_KEY =
  /(^|[-_.])(authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)($|[-_.])/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      SENSITIVE_KEY.test(key) ? [] : [[key, sanitizeValue(entry)]],
    ),
  );
}

export function sanitizeRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}
