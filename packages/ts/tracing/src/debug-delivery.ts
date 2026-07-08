export const PRODUCTION_BASE_URL = "https://api.uselemma.ai";
export const INGEST_PATH = "/traces/ingest";
export const EXPECTED_INGEST_SUCCESS_STATUS = 201;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidProjectId(projectId: string): boolean {
  return UUID_REGEX.test(projectId);
}

export function apiKeySuffix(apiKey: string): string {
  if (apiKey.length <= 4) return apiKey;
  return `...${apiKey.slice(-4)}`;
}

export function buildConfigWarnings(
  baseUrl: string,
  projectId: string,
): string[] {
  const warnings: string[] = [];
  if (baseUrl !== PRODUCTION_BASE_URL) {
    warnings.push(`baseUrl is not production (${PRODUCTION_BASE_URL})`);
  }
  if (!isValidProjectId(projectId)) {
    warnings.push("projectId is not a valid UUID");
  }
  return warnings;
}

export function ingestFailureHint(status: number): string | undefined {
  switch (status) {
    case 401:
      return "check LEMMA_API_KEY";
    case 403:
      return "API key doesn't own this project_id";
    case 429:
      return "ingest rate limit exceeded; retry with backoff";
    case 404:
      return "baseUrl likely wrong (not Lemma API)";
    default:
      return undefined;
  }
}

export function pickResponseHeaders(
  headers: Headers,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of ["cf-ray", "server", "date"]) {
    const value = headers.get(name);
    if (value) picked[name] = value;
  }
  return picked;
}

export function pickResponseHeadersFromRecord(
  headers: Record<string, string>,
): Record<string, string> {
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const picked: Record<string, string> = {};
  for (const name of ["cf-ray", "server", "date"]) {
    const value = lowered[name];
    if (value) picked[name] = value;
  }
  return picked;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
