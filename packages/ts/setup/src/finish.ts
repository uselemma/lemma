import type { Approval, ApprovedKey } from "./api.js";
import type { SetupEnvironment } from "./context.js";
import {
  API_KEY_VARIABLE,
  keptIngestLines,
  missingIngestLine,
  placeIngestKey,
  PROJECT_ID_VARIABLE,
  saveIngestKeyPrivately,
  writeEnvExample,
  type PlaceableEnvTarget,
} from "./env-file.js";
import {
  keptMcpLines,
  mcpServerUrl,
  missingMcpLine,
  placeMcpKey,
  saveMcpEntryPrivately,
  type PlaceableMcpTarget,
} from "./mcp/targets.js";
import type { PendingSetup } from "./pending.js";
import type { SetupPlan } from "./plan.js";
import {
  isPrivateTarget,
  type KeyOutcome,
  type Placement,
  type PrivateSave,
  type PrivateTarget,
} from "./placement.js";

/**
 * One key's outcome. A key the server kept is reported as kept when the
 * client reported it, and as missing otherwise. A new key goes where the
 * plan says, or to its private file; it is planned there when the plan's
 * target is the private file.
 */
async function keyOutcome<Placeable extends { kind: string }>(input: {
  approved: ApprovedKey;
  reported: boolean;
  target: Placeable | PrivateTarget;
  kept: () => Promise<string[]>;
  missing: string;
  place: (target: Placeable, apiKey: string) => Promise<Placement>;
  savePrivately: (apiKey: string, reason: string) => Promise<PrivateSave>;
}): Promise<KeyOutcome> {
  const { approved, target } = input;
  if (approved.kind === "kept") {
    return input.reported
      ? { kind: "kept", lines: await input.kept() }
      : { kind: "nothing-saved", lines: [input.missing] };
  }
  const placement: Placement = isPrivateTarget(target)
    ? { placed: false, reason: target.reason }
    : await input.place(target, approved.key);
  if (placement.placed) return { kind: "written", lines: placement.lines };
  const saved = await input.savePrivately(approved.key, placement.reason);
  return saved.saved
    ? {
        kind: "saved-privately",
        planned: isPrivateTarget(target),
        lines: saved.lines,
      }
    : { kind: "nothing-saved", lines: saved.lines };
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
  const { env, mcp: mcpTarget } = setupPlan;
  const mcpUrl = mcpServerUrl(pending.apiUrl);
  const print = (lines: readonly string[]) => {
    for (const line of lines) environment.output(line);
  };

  print([
    "Approved.",
    `Project ID: ${approval.projectId}`,
    `Agent name: ${approval.agentName}`,
  ]);

  const ingest = await keyOutcome<PlaceableEnvTarget>({
    approved: approval.ingest,
    reported: approval.projectId === pending.existingIngestProjectId,
    target: env,
    kept: () => keptIngestLines(env, environment.run),
    missing: missingIngestLine(approval.projectId),
    place: (target, apiKey) =>
      placeIngestKey({
        target,
        projectId: approval.projectId,
        apiKey,
        run: environment.run,
      }),
    savePrivately: (apiKey, reason) =>
      saveIngestKeyPrivately({
        fallbackPath: env.fallbackPath,
        projectId: approval.projectId,
        apiKey,
        reason,
      }),
  });
  print(ingest.lines);
  print(await writeEnvExample(setupPlan.example));

  const mcp = await keyOutcome<PlaceableMcpTarget>({
    approved: approval.mcp,
    reported: pending.existingMcpTenantId !== null,
    target: mcpTarget,
    kept: async () => keptMcpLines(mcpTarget),
    missing: missingMcpLine(mcpTarget),
    place: (target, apiKey) =>
      placeMcpKey({
        target,
        url: mcpUrl,
        apiKey,
        run: environment.run,
      }),
    savePrivately: (apiKey, reason) =>
      saveMcpEntryPrivately({
        target: mcpTarget,
        url: mcpUrl,
        apiKey,
        reason,
      }),
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
