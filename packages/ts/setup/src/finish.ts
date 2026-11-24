import type { Approval } from "./api.js";
import type { RunCommand } from "./command.js";
import type { SetupEnvironment } from "./context.js";
import {
  keepIngestKey,
  missingIngestLine,
  placeIngestKey,
  saveIngestKeyPrivately,
  writeEnvExample,
  type AppEnv,
  type EnvTarget,
  type IngestOutcome,
  type PrivateSave,
} from "./env-file.js";
import {
  keptMcpLine,
  manualMcpLines,
  mcpServerUrl,
  placeMcpServer,
  type McpTarget,
  type PlaceableMcpTarget,
} from "./mcp/targets.js";
import type { PendingSetup } from "./pending.js";
import type { SetupPlan } from "./plan.js";
import type { Placement } from "./placement.js";
import { listed } from "./shared.js";

/**
 * The outcome of saving a new key to its private file. `planned` is whether
 * the plan's target was that file, as opposed to a failed write falling back
 * to it.
 */
function privateSaveOutcome(
  saved: PrivateSave,
  planned: boolean,
): IngestOutcome {
  return saved.saved
    ? { kind: "saved-privately", planned, lines: saved.lines }
    : { kind: "nothing-saved", lines: saved.lines };
}

/**
 * The ingest key's outcome. A key the server kept is reported as kept when
 * the client reported a key for the approved project, with the app's API
 * values set beside it, and as missing otherwise. A new key goes to `.env`
 * with those values, or to its private file when the plan says so or the
 * write fails.
 */
async function finishIngestKey(input: {
  approval: Approval;
  pending: PendingSetup;
  target: EnvTarget;
  appEnv: AppEnv;
  run: RunCommand;
}): Promise<IngestOutcome> {
  const { approval, pending, target, appEnv, run } = input;
  const { projectId, ingest } = approval;
  if (ingest.kind === "kept") {
    if (projectId !== pending.existingIngestProjectId) {
      return { kind: "nothing-saved", lines: [missingIngestLine(projectId)] };
    }
    const kept = await keepIngestKey({ target, appEnv, run });
    return {
      kind: kept.complete ? "kept" : "kept-incomplete",
      lines: kept.lines,
    };
  }
  const planned = target.kind === "private";
  const placement: Placement = planned
    ? { placed: false, reason: target.reason }
    : await placeIngestKey({
        target,
        projectId,
        apiKey: ingest.key,
        appEnv,
        run,
      });
  if (placement.placed) return { kind: "written", lines: placement.lines };
  const saved = await saveIngestKeyPrivately({
    fallbackPath: target.fallbackPath,
    projectId,
    apiKey: ingest.key,
    appEnv,
    reason: placement.reason,
  });
  return privateSaveOutcome(saved, planned);
}

/**
 * Where the coding agent's `lemma` server ended up. `written` carries the
 * target the agent still signs in to. `added-by-hand` means setup printed
 * it for the person to add: `planned` when setup announced that before
 * approval, otherwise because a write failed.
 */
export type McpOutcome =
  | { kind: "written"; target: PlaceableMcpTarget; lines: string[] }
  | { kind: "kept"; lines: string[] }
  | { kind: "added-by-hand"; planned: boolean; lines: string[] };

/**
 * The `lemma` server's outcome: the server the plan kept, the one setup
 * wrote without a key, or the one it printed for the person to add because
 * the plan said so or the write failed.
 */
async function finishMcpServer(input: {
  apiUrl: PendingSetup["apiUrl"];
  target: McpTarget;
  run: RunCommand;
}): Promise<McpOutcome> {
  const { target, run } = input;
  const url = mcpServerUrl(input.apiUrl);
  switch (target.kind) {
    case "kept":
      return { kind: "kept", lines: [keptMcpLine(target.codingAgentName)] };
    case "manual":
      return {
        kind: "added-by-hand",
        planned: true,
        lines: manualMcpLines({ target, url, reason: target.reason }),
      };
    case "claude-cli":
    case "file": {
      const placement = await placeMcpServer({ target, url, run });
      return placement.placed
        ? { kind: "written", target, lines: placement.lines }
        : {
            kind: "added-by-hand",
            planned: false,
            lines: manualMcpLines({ target, url, reason: placement.reason }),
          };
    }
  }
}

/** Whether the `lemma` server's outcome fails the run: only a write that failed after approval does. */
function mcpFailsRun(outcome: McpOutcome): boolean {
  return outcome.kind === "added-by-hand" && !outcome.planned;
}

/**
 * Whether the ingest key's outcome fails the run. A private file announced
 * before approval is the plan; one a failed write fell back to, or no key
 * at all, is not.
 */
function ingestFailsRun(outcome: IngestOutcome): boolean {
  switch (outcome.kind) {
    case "written":
    case "kept":
      return false;
    case "saved-privately":
      return !outcome.planned;
    case "kept-incomplete":
    case "nothing-saved":
      return true;
  }
}

/**
 * Writes what the one-time exchange returned, and the coding agent's
 * `lemma` server. Each is written on its own and reported as soon as it
 * lands, so a later failure still leaves the earlier result on screen; no
 * failure loses the ingest key.
 */
export async function finishSetup(input: {
  environment: SetupEnvironment;
  pending: PendingSetup;
  setupPlan: SetupPlan;
  approval: Approval;
}): Promise<{ failed: boolean; mcp: McpOutcome }> {
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
    appEnv: setupPlan.appEnv,
    run,
  });
  print(ingest.lines);
  print(await writeEnvExample(setupPlan.example, setupPlan.appEnv));

  const mcp = await finishMcpServer({
    apiUrl: pending.apiUrl,
    target: setupPlan.mcp,
    run,
  });
  print(mcp.lines);

  if (ingest.kind === "written" || ingest.kind === "saved-privately") {
    print(["The new ingest key can only send traces to this project."]);
  }
  print([
    `Before you deploy, add ${listed(setupPlan.appEnv.variables)} to your deployment's environment variables or secrets.`,
  ]);
  return { failed: ingestFailsRun(ingest) || mcpFailsRun(mcp), mcp };
}
