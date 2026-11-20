import { startSetupAuthorization, type StartRequest } from "./api.js";
import {
  appDirectory,
  SETUP_COMMAND,
  type SetupEnvironment,
} from "./context.js";
import type { HarnessId } from "./harness.js";
import { checkIngestKey, checkMcpKey } from "./keys.js";
import { newPendingSetup, writePendingSetup } from "./pending.js";
import { plan, plannedNotes } from "./plan.js";
import {
  boundedInterval,
  MAX_CODE_LIFETIME_SECONDS,
  WAIT_BUDGET_SECONDS,
} from "./poll.js";
import { setupPaths } from "./setup-paths.js";

/** `start`'s options, already validated and normalized by `parseCommand`. */
export type StartOptions = {
  harness: HarnessId;
  projectName: string;
  agentName: string;
  openBrowser: boolean;
  apiUrl: string;
  repository?: string;
  framework?: string;
  org?: string;
};

/** The IDs of the keys Lemma confirmed the client already holds. */
type VerifiedKeys = {
  ingestProjectId: string | null;
  mcpTenantId: string | null;
};

export function startRequest(
  options: StartOptions,
  verified: VerifiedKeys,
): StartRequest {
  return {
    harness: options.harness,
    inferred: {
      project_name: options.projectName,
      agent_name: options.agentName,
      repository: options.repository,
      framework: options.framework,
    },
    org_slug: options.org,
    existing_ingest_key_project_id: verified.ingestProjectId ?? undefined,
    existing_mcp_key_tenant_id: verified.mcpTenantId ?? undefined,
  };
}

/**
 * Starts the handshake and returns at once: prints the approval URL and
 * code, opens the browser, and saves the device code for `wait`.
 */
export async function runStart(
  options: StartOptions,
  environment: SetupEnvironment,
): Promise<void> {
  const { apiUrl, harness } = options;
  const appDir = await appDirectory(environment);
  const paths = setupPaths(environment.homeDir, appDir);
  const setupPlan = await plan({ environment, appDir, harness, paths });

  const [ingest, mcp] = await Promise.all([
    checkIngestKey({
      existing: setupPlan.env.existing,
      apiUrl,
      fetch: environment.fetch,
    }),
    checkMcpKey({
      existing: setupPlan.mcp.existing,
      codingAgentName: setupPlan.mcp.codingAgentName,
      apiUrl,
      fetch: environment.fetch,
    }),
  ]);

  const authorization = await startSetupAuthorization(
    apiUrl,
    startRequest(options, {
      ingestProjectId: ingest.verified,
      mcpTenantId: mcp.verified,
    }),
    environment.fetch,
  );
  // Printed only once the handshake exists: on an environment without
  // coding-agent setup, the one line saying so is the whole output.
  for (const note of [ingest.note, mcp.note, ...plannedNotes(setupPlan)]) {
    if (note) environment.output(note);
  }

  const startedAt = environment.now();
  const interval = boundedInterval(authorization.interval);
  await writePendingSetup(
    paths.pending,
    newPendingSetup({
      appDir,
      apiUrl,
      harness,
      deviceCode: authorization.deviceCode,
      userCode: authorization.userCode,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresAt:
        startedAt +
        Math.min(authorization.expiresIn, MAX_CODE_LIFETIME_SECONDS) * 1_000,
      interval,
      nextPollAt: startedAt + interval * 1_000,
      existingIngestProjectId: ingest.verified,
      existingMcpTenantId: mcp.verified,
    }),
  );

  environment.output(
    `Approve connecting ${setupPlan.mcp.codingAgentName} to Lemma in your browser:`,
  );
  environment.output(authorization.verificationUriComplete);
  environment.output(
    `Check that the page shows this code: ${authorization.userCode}`,
  );
  if (options.openBrowser) {
    try {
      await environment.launchBrowser(authorization.verificationUriComplete);
    } catch {
      environment.output(
        "Could not open a browser. Open the URL above to approve.",
      );
    }
  }
  environment.output(
    `Next, run \`${SETUP_COMMAND} wait\` in this directory. Each run waits up to ${WAIT_BUDGET_SECONDS}s; run it again while it reports that approval is pending.`,
  );
}
