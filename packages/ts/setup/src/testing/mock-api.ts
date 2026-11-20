import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
};

export type MockResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type MockApiOptions = {
  start?: MockResponse;
  /** Answers to successive token polls; the last one repeats. */
  polls?: MockResponse[];
  /** `GET /auth/key` answers by bearer key; any other key gets 401. */
  keys?: Record<string, MockResponse>;
};

export const DEVICE_CODE = "d".repeat(64);
export const USER_CODE = "ABCD-EFGH-JK";

export const pending: MockResponse = {
  status: 200,
  body: { status: "authorization_pending", interval: 5 },
};

export const slowDown: MockResponse = {
  status: 429,
  body: { status: "slow_down", interval: 5 },
  headers: { "retry-after": "5" },
};

export const expired: MockResponse = {
  status: 400,
  body: { status: "expired_token" },
};

export const denied: MockResponse = {
  status: 403,
  body: { status: "access_denied" },
};

export const plainNotFound: MockResponse = {
  status: 404,
  body: { detail: "Not found" },
};

export function approved(body: Record<string, unknown>): MockResponse {
  return { status: 200, body: { status: "approved", ...body } };
}

export function keyDescription(
  tenantId: string,
  projectId: string | null,
  scope: string,
): MockResponse {
  return {
    status: 200,
    body: { tenant_id: tenantId, project_id: projectId, scope },
  };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A local stand-in for the Lemma API endpoints setup calls. */
export class MockApi {
  readonly requests: RecordedRequest[] = [];
  url = "";
  private server: Server | null = null;
  private pollIndex = 0;

  constructor(private readonly options: MockApiOptions) {}

  async listen(): Promise<this> {
    this.server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const recorded: RecordedRequest = {
        method: request.method ?? "GET",
        path: url.pathname,
        headers: request.headers,
        body: await readBody(request),
      };
      this.requests.push(recorded);
      const answer = this.answer(recorded);
      response.writeHead(answer.status, {
        "content-type": "application/json",
        ...answer.headers,
      });
      response.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((resolvePromise) =>
      this.server?.listen(0, "127.0.0.1", resolvePromise),
    );
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  private answer(request: RecordedRequest): MockResponse {
    if (
      request.method === "POST" &&
      request.path === "/setup/device-authorizations"
    ) {
      return (
        this.options.start ?? {
          status: 201,
          body: {
            device_code: DEVICE_CODE,
            user_code: USER_CODE,
            verification_uri: `${this.url}/connect/setup`,
            verification_uri_complete: `${this.url}/connect/setup?user_code=${USER_CODE}`,
            expires_in: 600,
            interval: 5,
          },
        }
      );
    }
    if (
      request.method === "POST" &&
      request.path === "/setup/device-authorizations/token"
    ) {
      const polls = this.options.polls ?? [];
      const answer =
        polls[Math.min(this.pollIndex, polls.length - 1)] ?? expired;
      this.pollIndex += 1;
      return answer;
    }
    if (request.method === "GET" && request.path === "/auth/key") {
      const key = /^Bearer (.+)$/.exec(
        request.headers.authorization ?? "",
      )?.[1];
      return (
        (key && this.options.keys?.[key]) || {
          status: 401,
          body: { detail: "Invalid API key" },
        }
      );
    }
    return { status: 404, body: { detail: "Not found" } };
  }

  paths(): string[] {
    return this.requests.map((request) => `${request.method} ${request.path}`);
  }

  startBody(): Record<string, unknown> | undefined {
    return this.requests.find(
      (request) => request.path === "/setup/device-authorizations",
    )?.body as Record<string, unknown> | undefined;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise) =>
      this.server
        ? this.server.close(() => resolvePromise())
        : resolvePromise(),
    );
  }
}
