import type { Approval } from "./api.js";
import type { RunCommand } from "./command.js";
import type { SetupEnvironment } from "./context.js";
import {
  API_KEY_VARIABLE,
  keptIngestLines,
  missingIngestLine,
  placeIngestKey,
  PROJECT_ID_VARIABLE,
  saveIngestKeyPrivately,
  writeEnvExample,
  type EnvTarget,
} from "./env-file.js";
import {
  keptMcpLines,
  mcpServerUrl,
  missingMcpLine,
  placeMcpKey,
  saveMcpEntryPrivately,
  type McpTarget,
} from "./mcp/targets.js";
import type { PendingSetup } from "./pending.js";
import type { SetupPlan } from "./plan.js";
import {
  isPrivateTarget,
  type KeyOutcome,
  type Placement,
  type PrivateSave,
} from "./placement.js";

/**
 * The outcome of saving a new key to its private file. `planned` is whether
 * the plan's target was that file, as opposed to a failed write falling back
 * to it.
 */
function privateSaveOutcome(saved: PrivateSave, planned: boolean): KeyOutcome {
  return saved.saved
    ? { kind: "saved-privately", planned, lines: saved.lines }
    : { kind: "nothing-saved", lines: saved.lines };
}

/**
 * The ingest key's outcome. A key the server kept is reported as kept when
 * the client reported a key for the approved project, and as missing
 * otherwise. A new key goes to `.env`, or to its private file when the plan
 * says so or the write fails.
 */
async function finishIngestKey(input: {
  approval: Approval;
  pending: PendingSetup;
  target: EnvTarget;
  run: RunCommand;
}): Promise<KeyOutcome> {
  const { approval, pending, target, run } = input;
  const { projectId, ingest } = approval;
  if (ingest.kind === "kept") {
    return projectId === pending.existingIngestProjectId
      ? { kind: "kept", lines: await keptIngestLines(target, run) }
      : { kind: "nothing-saved", lines: [missingIngestLine(projectId)] };
  }
  const placement: Placement = isPrivateTarget(target)
    ? { placed: false, reason: target.reason }
    : await placeIngestKey({ target, projectId, apiKey: ingest.key, run });
  if (placement.placed) return { kind: "written", lines: placement.lines };
  const saved = await saveIngestKeyPrivately({
    fallbackPath: target.fallbackPath,
    projectId,
    apiKey: ingest.key,
    reason: placement.reason,
  });
  return privateSaveOutcome(saved, isPrivateTarget(target));
}

/**
 * The admin key's outcome. A key the server kept is reported as kept when
 * the client reported a key, and as missing otherwise. A new key goes to the
 * coding agent's MCP config, or to its private file when the plan says so
 * or the write fails.
 */
async function finishMcpKey(input: {
  approval: Approval;
  pending: PendingSetup;
  target: McpTarget;
  run: RunCommand;
}): Promise<KeyOutcome> {
  const { approval, pending, target, run } = input;
  const { mcp } = approval;
  if (mcp.kind === "kept") {
    return pending.existingMcpTenantId !== null
      ? { kind: "kept", lines: keptMcpLines(target) }
      : { kind: "nothing-saved", lines: [missingMcpLine(target)] };
  }
  const url = mcpServerUrl(pending.apiUrl);
  const placement: Placement = isPrivateTarget(target)
    ? { placed: false, reason: target.reason }
    : await placeMcpKey({ target, url, apiKey: mcp.key, run });
  if (placement.placed) return { kind: "written", lines: placement.lines };
  const saved = await saveMcpEntryPrivately({
    target,
    url,
    apiKey: mcp.key,
    reason: placement.reason,
  });
  return privateSaveOutcome(saved, isPrivateTarget(target));
}

/**
 * Whether a key's outcome fails the run. A private file announced before
 * approval is the plan; one a failed write fell back to, or no key at all,
 * is not.
 */
function failsRun(outcome: KeyOutcome): boolean {
  switch (outcome.kind) {
    case "written":
    case "kept":
      return false;
    case "saved-privately":
      return !outcome.planned;
    case "nothing-saved":
      return true;
  }
}

/**
 * Writes what the one-time exchange returned. Each key is written on its
 * own and reported as soon as it lands, so a later failure still leaves the
 * earlier result on screen; no failure loses a key.
 */
export async function finishSetup(input: {
  environment: SetupEnvironment;
  pending: PendingSetup;
  setupPlan: SetupPlan;
  approval: Approval;
}): Promise<{ failed: boolean }> {
  const { environment, pending, setupPlan, approval } = input;
  const { run } = environment;
  const print = (lines: readonly string[]) => {
    for (const line of lines) environment.output(line);
  };

  print([
    "Approved.",
    `Project ID: ${approval.projectId}`,
    `Agent name: ${approval.agentName}`,
  ]);

  const ingest = await finishIngestKey({
    approval,
    pending,
    target: setupPlan.env,
    run,
  });
  print(ingest.lines);
  print(await writeEnvExample(setupPlan.example));

  const mcp = await finishMcpKey({
    approval,
    pending,
    target: setupPlan.mcp,
    run,
  });
  print(mcp.lines);

  if (ingest.kind === "written" || ingest.kind === "saved-privately") {
    print(["The new ingest key can only send traces to this project."]);
  }
  print([
    `Before you deploy, add ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE} to your deployment's environment variables or secrets.`,
  ]);
  const failed = failsRun(ingest) || failsRun(mcp);
  if (!failed) print(["Lemma setup finished."]);
  return { failed };
}
