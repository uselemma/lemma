export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export type CursorAgent = {
  id: string;
  name: string;
  url: string;
  latestRunId?: string;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: CursorRunStatus;
  result?: string;
  durationMs?: number;
};

export type CreateCursorAgentRequest = {
  name: string;
  prompt: { text: string };
  model?: {
    id: string;
    params?: Array<{ id: string; value: string }>;
  };
  repos: Array<{
    url: string;
    prUrl?: string;
    startingRef?: string;
  }>;
  autoCreatePR?: boolean;
  skipReviewerRequest?: boolean;
  workOnCurrentBranch?: boolean;
  mode?: "agent";
  envVars?: Record<string, string>;
};

export type CreateCursorAgentResponse = {
  agent: CursorAgent;
  run: CursorRun;
};

export type CursorAgentClient = {
  createAgent(
    request: CreateCursorAgentRequest,
  ): Promise<CreateCursorAgentResponse>;
};

const CURSOR_API_BASE = "https://api.cursor.com/v1";

export function createCursorAgentClient({
  apiKey,
  fetchImpl = fetch,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): CursorAgentClient {
  async function request<T>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetchImpl(`${CURSOR_API_BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    return parseJsonResponse<T>(response, `Cursor API ${pathname}`);
  }

  return {
    createAgent: (body) =>
      request<CreateCursorAgentResponse>("/agents", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  };
}

export async function parseJsonResponse<T>(
  response: Response,
  label: string,
): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `${label} failed with ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload as T;
}
