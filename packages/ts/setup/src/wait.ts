import { pollSetupAuthorization } from "./api.js";
import {
  appDirectory,
  SETUP_COMMAND,
  type SetupEnvironment,
} from "./context.js";
import { SetupError } from "./errors.js";
import { finishSetup } from "./finish.js";
import { signInToMcp } from "./mcp/sign-in.js";
import {
  deletePendingSetup,
  readPendingSetup,
  writePendingSetup,
} from "./pending.js";
import { plan, plannedNotes } from "./plan.js";
import { WAIT_BUDGET_SECONDS, waitForApproval } from "./poll.js";
import { setupPaths } from "./setup-paths.js";

type WaitResult = { status: "approved" } | { status: "pending" };

export type WaitOptions = {
  /**
   * Runs the agent's sign-in even when stdin is not a terminal, as when a
   * coding agent runs `wait`; without it the sign-in runs only at a terminal.
   */
  signIn: boolean;
};

/**
 * Polls the handshake `start` began in this directory for up to
 * `WAIT_BUDGET_SECONDS`. On approval it writes `.env`, `.env.example`, and
 * the MCP config, then signs the coding agent in to Lemma's MCP server. The
 * plan is made again, since files can change between `start` and `wait`,
 * and its notes are printed before polling, so every private file, kept
 * server, and manual add is announced before the key arrives.
 */
export async function runWait(
  options: WaitOptions,
  environment: SetupEnvironment,
): Promise<WaitResult> {
  const appDir = await appDirectory(environment);
  const paths = setupPaths(environment.homeDir, appDir);
  const pending = await readPendingSetup(paths.pending, appDir);
  const setupPlan = await plan({
    environment,
    appDir,
    harness: pending.harness,
    paths,
    apiUrl: pending.apiUrl,
  });
  const deleteSpentPendingFile = async () => {
    for (const line of await deletePendingSetup(paths.pending)) {
      environment.output(line);
    }
  };

  for (const note of plannedNotes(setupPlan)) environment.output(note);
  environment.output(
    `Waiting for approval at ${pending.verificationUriComplete} (code ${pending.userCode})…`,
  );
  const outcome = await waitForApproval({
    poll: () =>
      pollSetupAuthorization(
        pending.apiUrl,
        pending.deviceCode,
        environment.fetch,
      ),
    schedule: { interval: pending.interval, nextPollAt: pending.nextPollAt },
    expiresAt: pending.expiresAt,
    budgetEndsAt: environment.now() + WAIT_BUDGET_SECONDS * 1_000,
    sleep: environment.sleep,
    now: environment.now,
    onSchedule: (schedule) =>
      writePendingSetup(paths.pending, { ...pending, ...schedule }),
  });

  switch (outcome.status) {
    case "ended":
      if (outcome.codeSpent) await deleteSpentPendingFile();
      throw outcome.error;
    case "pending":
      environment.output(
        `Approval is still pending. Run \`${SETUP_COMMAND} wait\` again.`,
      );
      return { status: "pending" };
    case "approved": {
      // Deleted only after the writes, so a failed delete cannot cost the
      // key this one-time exchange returned.
      const { failed, mcp } = await finishSetup({
        environment,
        pending,
        setupPlan,
        approval: outcome.approval,
      }).finally(deleteSpentPendingFile);
      // After the spent code is gone: the sign-in waits on the person, who
      // may interrupt it.
      if (mcp.kind === "written") {
        await signInToMcp({
          signIn: mcp.target.signIn,
          run: options.signIn || environment.interactive,
          environment,
        });
        environment.output(`MCP: ${mcp.target.reload}.`);
      }
      if (failed) {
        throw new SetupError(
          "Some setup steps did not complete; see the lines above.",
        );
      }
      environment.output("Lemma setup finished.");
      return { status: "approved" };
    }
  }
}
