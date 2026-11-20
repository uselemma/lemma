import packageJson from "../package.json" with { type: "json" };

import { SetupError } from "./errors.js";
import type { HarnessId } from "./harness.js";
import { API_KEY_PATTERN, isRecord, isUuid } from "./shared.js";

export const DEFAULT_API_URL = "https://api.uselemma.ai";

/** One API call's budget, so a stalled connection fails instead of hanging the agent's command. */
const REQUEST_TIMEOUT_MS = 15_000;

/** What a plain 404 from the setup endpoints means: the flow is off for that environment. */
export const SETUP_UNAVAILABLE_MESSAGE =
  "Coding-agent setup isn't available on this Lemma environment yet. Use manual setup in the dashboard.";

/** The typed 404 for a code the server has no setup for. */
const SETUP_NOT_FOUND_CODE = "setup_authorization_not_found";

const USER_AGENT = `${packageJson.name}/${packageJson.version}`;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/** `value` without a trailing slash; HTTPS, or HTTP only on this machine. */
export function normalizedHttpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SetupError(`${label} is not a valid URL: ${value}`);
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHost(url.hostname))
  ) {
    throw new SetupError(`${label} must use HTTPS (or HTTP on localhost)`);
  }
  return url.toString().replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function detailOf(body: unknown, status: number): string {
  return isRecord(body) && typeof body.detail === "string"
    ? body.detail
    : `HTTP ${status}`;
}

export type Fetch = typeof fetch;

/**
 * A 404 without an error code. The setup endpoints answer it while the
 * platform's coding-agent onboarding flag is off; a typed 404 names its
 * `code`.
 */
function isPlainNotFound(response: Response, body: unknown): boolean {
  return (
    response.status === 404 &&
    !(isRecord(body) && typeof body.code === "string")
  );
}

function requestInit(init: RequestInit): RequestInit {
  return {
    ...init,
    headers: { "user-agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export type StartRequest = {
  harness: HarnessId;
  inferred: {
    project_name: string;
    agent_name: string;
    repository?: string;
    framework?: string;
  };
  org_slug?: string;
  existing_ingest_key_project_id?: string;
  existing_mcp_key_tenant_id?: string;
};

type SetupAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export async function startSetupAuthorization(
  apiUrl: string,
  request: StartRequest,
  fetchImplementation: Fetch,
): Promise<SetupAuthorization> {
  let response: Response;
  try {
    response = await fetchImplementation(
      `${apiUrl}/setup/device-authorizations`,
      requestInit({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
  } catch {
    throw new SetupError(`Lemma did not respond at ${apiUrl}`);
  }
  const body = await readJson(response);
  if (isPlainNotFound(response, body)) {
    throw new SetupError(SETUP_UNAVAILABLE_MESSAGE);
  }
  if (!response.ok) {
    throw new SetupError(
      `Lemma could not start setup: ${detailOf(body, response.status)}`,
    );
  }
  if (
    !isRecord(body) ||
    typeof body.device_code !== "string" ||
    typeof body.user_code !== "string" ||
    typeof body.verification_uri_complete !== "string" ||
    typeof body.expires_in !== "number" ||
    typeof body.interval !== "number"
  ) {
    throw new SetupError("Lemma returned an invalid setup authorization");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUriComplete: normalizedHttpUrl(
      body.verification_uri_complete,
      "Lemma approval URL",
    ),
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

/** A key the exchange returned, or the server's word that the client's own key stays. */
export type ApprovedKey = { kind: "new"; key: string } | { kind: "kept" };

export type Approval = {
  projectId: string;
  agentName: string;
  ingest: ApprovedKey;
  mcp: ApprovedKey;
};

export type TokenPoll =
  | { status: "authorization_pending"; interval?: number }
  | { status: "slow_down"; interval?: number }
  | { status: "expired_token" }
  | { status: "access_denied" }
  | { status: "approved"; approval: Approval }
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "error"; retryable: boolean; message: string };

/** An absent key means the server kept the client's; a present one must be writable. */
function approvedKey(value: unknown): ApprovedKey | null {
  if (value === undefined) return { kind: "kept" };
  return typeof value === "string" && API_KEY_PATTERN.test(value)
    ? { kind: "new", key: value }
    : null;
}

function approvedPoll(body: Record<string, unknown>): TokenPoll {
  const ingest = approvedKey(body.ingest_key);
  const mcp = approvedKey(body.mcp_key);
  if (
    !isUuid(body.project_id) ||
    typeof body.agent_name !== "string" ||
    !ingest ||
    !mcp
  ) {
    return {
      status: "error",
      retryable: false,
      message: "Lemma returned an invalid approval",
    };
  }
  return {
    status: "approved",
    approval: {
      projectId: body.project_id,
      agentName: body.agent_name,
      ingest,
      mcp,
    },
  };
}

export async function pollSetupAuthorization(
  apiUrl: string,
  deviceCode: string,
  fetchImplementation: Fetch,
): Promise<TokenPoll> {
  let response: Response;
  try {
    response = await fetchImplementation(
      `${apiUrl}/setup/device-authorizations/token`,
      requestInit({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      }),
    );
  } catch {
    return {
      status: "error",
      retryable: true,
      message: `Lemma did not respond at ${apiUrl}`,
    };
  }
  const body = await readJson(response);
  if (isRecord(body)) {
    const interval =
      typeof body.interval === "number" ? body.interval : undefined;
    switch (body.status) {
      case "authorization_pending":
        return { status: "authorization_pending", interval };
      case "slow_down":
        return { status: "slow_down", interval };
      case "expired_token":
        return { status: "expired_token" };
      case "access_denied":
        return { status: "access_denied" };
      case "approved":
        return approvedPoll(body);
    }
    if (response.status === 404 && body.code === SETUP_NOT_FOUND_CODE) {
      return { status: "not_found" };
    }
  }
  if (isPlainNotFound(response, body)) return { status: "unavailable" };
  // A body without a known status is a gateway or guard answer (rate limit,
  // validation, outage), not part of the handshake.
  return {
    status: "error",
    retryable: response.status >= 500,
    message: `Lemma setup polling failed: ${detailOf(body, response.status)}`,
  };
}

const API_KEY_SCOPES = ["ingest", "read", "admin"] as const;
type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return API_KEY_SCOPES.some((scope) => scope === value);
}

/** What `GET /auth/key` says about the key that calls it. */
type ApiKeyDescription = {
  tenantId: string;
  /** Null for a key that is not limited to one project. */
  projectId: string | null;
  scope: ApiKeyScope;
};

/**
 * The calling key's own organization, project limit, and scope, or null when
 * Lemma does not answer for it (invalid, expired, revoked, unreachable, or
 * setup off). A null answer leaves the key unverified, and the server mints
 * a new one.
 */
export async function describeApiKey(
  apiUrl: string,
  apiKey: string,
  fetchImplementation: Fetch,
): Promise<ApiKeyDescription | null> {
  try {
    const response = await fetchImplementation(
      `${apiUrl}/auth/key`,
      requestInit({
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      }),
    );
    if (response.status !== 200) return null;
    const body = await readJson(response);
    if (
      !isRecord(body) ||
      !isUuid(body.tenant_id) ||
      !(body.project_id === null || isUuid(body.project_id)) ||
      !isApiKeyScope(body.scope)
    ) {
      return null;
    }
    return {
      tenantId: body.tenant_id,
      projectId: body.project_id,
      scope: body.scope,
    };
  } catch {
    return null;
  }
}
