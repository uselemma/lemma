import {
  SETUP_UNAVAILABLE_MESSAGE,
  type Approval,
  type TokenPoll,
} from "./api.js";
import { EXIT_CODES, SetupError } from "./errors.js";

/** RFC 8628's default interval, used until the server names one. */
const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** RFC 8628 §3.5: each `slow_down` adds five seconds to the interval. */
const SLOW_DOWN_STEP_SECONDS = 5;

/** Ceiling on any interval, so a bad value cannot stall `wait` past its budget. */
export const MAX_POLL_INTERVAL_SECONDS = 60;

/**
 * Ceiling on a code's lifetime. The server's codes live ten minutes; the cap
 * keeps a malformed `expires_in` from leaving a pending setup around for long.
 */
export const MAX_CODE_LIFETIME_SECONDS = 15 * 60;

/**
 * How long one `wait` polls before it returns "still pending". Coding agents
 * run each command under a default timeout of two minutes (Claude Code's is
 * 120 seconds), so `wait` returns well before it, leaving time for `npx` to
 * start.
 */
export const WAIT_BUDGET_SECONDS = 90;

/** Network failures in a row before giving up; one dropped request should not end setup. */
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

const EXPIRED_MESSAGE =
  "The setup code expired before it was approved. Run `start` again to get a new code.";

const NOT_FOUND_MESSAGE =
  "Lemma has no setup for this code. Run `start` again to get a new code.";

const DENIED_MESSAGE =
  "The setup was canceled or is no longer allowed. An owner or admin of the Lemma organization must approve it. Run `start` again to retry.";

export function boundedInterval(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  return Math.min(Math.ceil(seconds), MAX_POLL_INTERVAL_SECONDS);
}

/** When the next poll may run, and at what interval; persisted between `wait` runs. */
export type PollSchedule = { interval: number; nextPollAt: number };

export type WaitInput = {
  poll: () => Promise<TokenPoll>;
  schedule: PollSchedule;
  /** Epoch milliseconds at which the code expires. */
  expiresAt: number;
  /** Epoch milliseconds after which this run stops polling. */
  budgetEndsAt: number;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  /** Called after every answered poll, so a later `wait` keeps the pace. */
  onSchedule?: (schedule: PollSchedule) => Promise<void>;
};

export type WaitOutcome =
  | { status: "approved"; approval: Approval }
  | { status: "pending" }
  /** `codeSpent`: the code can never be approved now, so its pending setup can go. */
  | { status: "ended"; error: SetupError; codeSpent: boolean };

function ended(
  message: string,
  exitCode: SetupError["exitCode"],
  codeSpent: boolean,
): WaitOutcome {
  return {
    status: "ended",
    error: new SetupError(message, exitCode),
    codeSpent,
  };
}

/** Polls until the approval is exchanged, the code ends, or this run's budget is spent. */
export async function waitForApproval(input: WaitInput): Promise<WaitOutcome> {
  let interval = boundedInterval(input.schedule.interval);
  let nextPollAt = input.schedule.nextPollAt;
  let failures = 0;
  while (true) {
    if (nextPollAt >= input.expiresAt) {
      return ended(EXPIRED_MESSAGE, EXIT_CODES.expired, true);
    }
    if (nextPollAt > input.budgetEndsAt) return { status: "pending" };
    const delay = nextPollAt - input.now();
    if (delay > 0) await input.sleep(delay);

    const result = await input.poll();
    switch (result.status) {
      case "authorization_pending":
        failures = 0;
        if (result.interval !== undefined) {
          interval = boundedInterval(Math.max(result.interval, interval));
        }
        break;
      case "slow_down":
        failures = 0;
        interval = boundedInterval(
          Math.max(result.interval ?? 0, interval + SLOW_DOWN_STEP_SECONDS),
        );
        break;
      case "expired_token":
        return ended(EXPIRED_MESSAGE, EXIT_CODES.expired, true);
      case "not_found":
        return ended(NOT_FOUND_MESSAGE, EXIT_CODES.expired, true);
      case "access_denied":
        return ended(DENIED_MESSAGE, EXIT_CODES.denied, true);
      case "unavailable":
        return ended(SETUP_UNAVAILABLE_MESSAGE, EXIT_CODES.failure, false);
      case "error":
        failures += 1;
        if (!result.retryable || failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          return ended(result.message, EXIT_CODES.failure, false);
        }
        break;
      case "approved":
        return { status: "approved", approval: result.approval };
    }
    nextPollAt = input.now() + interval * 1_000;
    await input.onSchedule?.({ interval, nextPollAt });
  }
}
