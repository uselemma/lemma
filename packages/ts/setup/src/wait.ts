import { pollSetupAuthorization } from "./api.js";
import {
  appDirectory,
  SETUP_COMMAND,
  type SetupEnvironment,
} from "./context.js";
import { SetupError } from "./errors.js";
import { finishSetup } from "./finish.js";
import {
  deletePendingSetup,
  readPendingSetup,
  writePendingSetup,
} from "./pending.js";
import { plan, plannedNotes } from "./plan.js";
import { WAIT_BUDGET_SECONDS, waitForApproval } from "./poll.js";
import { setupPaths } from "./setup-paths.js";

type WaitResult = { status: "approved" } | { status: "pending" };

/**
 * Polls the handshake `start` began in this directory for up to
 * `WAIT_BUDGET_SECONDS`. On approval it writes `.env`, `.env.example`, and
 * the MCP config. The plan is made again, since files can change between
 * `start` and `wait`, and its notes are printed before polling so every
 * private file is announced before the keys arrive.
 */
export async function runWait(
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
      // keys this one-time exchange returned.
      const { failed } = await finishSetup({
        environment,
        pending,
        setupPlan,
        approval: outcome.approval,
      }).finally(deleteSpentPendingFile);
      if (failed) {
        throw new SetupError(
          "Some setup steps did not complete; see the lines above.",
        );
      }
      return { status: "approved" };
    }
  }
}
