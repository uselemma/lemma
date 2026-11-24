import { describe, expect, it } from "vitest";

import type { Approval, TokenPoll } from "./api.js";
import { EXIT_CODES } from "./errors.js";
import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  MAX_POLL_INTERVAL_SECONDS,
  waitForApproval,
  type PollSchedule,
  type WaitInput,
  type WaitOutcome,
} from "./poll.js";

const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
const APPROVAL: Approval = {
  projectId: PROJECT_ID,
  agentName: "support-bot",
  ingest: { kind: "new", key: "lemma_sk_ingest_0123456789abcdef" },
};
const APPROVED: TokenPoll = { status: "approved", approval: APPROVAL };

/** A clock that starts at 0 and only moves when the loop sleeps. */
function scripted(results: TokenPoll[], overrides: Partial<WaitInput> = {}) {
  let clock = 0;
  let index = 0;
  const slept: number[] = [];
  const schedules: PollSchedule[] = [];
  const input: WaitInput = {
    poll: async () => results[Math.min(index++, results.length - 1)],
    schedule: { interval: 5, nextPollAt: 5_000 },
    expiresAt: 600_000,
    budgetEndsAt: 90_000,
    sleep: async (milliseconds) => {
      slept.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    onSchedule: async (schedule) => {
      schedules.push(schedule);
    },
    ...overrides,
  };
  return { input, slept, schedules, polls: () => index };
}

function expectEnded(
  outcome: WaitOutcome,
  exitCode: number,
  codeSpent: boolean,
) {
  expect(outcome.status).toBe("ended");
  if (outcome.status !== "ended") return;
  expect(outcome.error.exitCode).toBe(exitCode);
  expect(outcome.codeSpent).toBe(codeSpent);
}

describe("waitForApproval", () => {
  it("polls through pending and slow_down, widening the interval on slow_down", async () => {
    const run = scripted([
      { status: "authorization_pending", interval: 5 },
      { status: "slow_down", interval: 5 },
      { status: "authorization_pending", interval: 5 },
      APPROVED,
    ]);
    await expect(waitForApproval(run.input)).resolves.toEqual({
      status: "approved",
      approval: APPROVAL,
    });
    expect(run.slept).toEqual([5_000, 5_000, 10_000, 10_000]);
    expect(run.schedules.map((schedule) => schedule.interval)).toEqual([
      5, 10, 10,
    ]);
  });

  it("returns pending once the budget is spent, having saved the next poll time", async () => {
    const run = scripted([{ status: "authorization_pending", interval: 5 }], {
      budgetEndsAt: 20_000,
    });
    await expect(waitForApproval(run.input)).resolves.toEqual({
      status: "pending",
    });
    expect(run.polls()).toBe(4);
    expect(run.schedules[run.schedules.length - 1]).toEqual({
      interval: 5,
      nextPollAt: 25_000,
    });
  });

  it("keeps a later run's pace: no early poll, and the widened interval stays", async () => {
    let clock = 3_000;
    const slept: number[] = [];
    const schedules: PollSchedule[] = [];
    await waitForApproval({
      poll: async () => ({ status: "authorization_pending", interval: 5 }),
      schedule: { interval: 10, nextPollAt: 8_000 },
      expiresAt: 600_000,
      budgetEndsAt: 20_000,
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
        clock += milliseconds;
      },
      now: () => clock,
      onSchedule: async (schedule) => {
        schedules.push(schedule);
      },
    });
    expect(slept).toEqual([5_000, 10_000]);
    expect(schedules[schedules.length - 1]).toEqual({
      interval: 10,
      nextPollAt: 28_000,
    });
  });

  it("caps a server interval", async () => {
    const run = scripted(
      [
        { status: "authorization_pending", interval: 10_000 },
        { status: "access_denied" },
      ],
      { budgetEndsAt: 600_000 },
    );
    await waitForApproval(run.input);
    expect(run.slept).toEqual([5_000, MAX_POLL_INTERVAL_SECONDS * 1_000]);
  });

  it("ends with a spent code on expiry, denial, or a code the server does not know", async () => {
    expectEnded(
      await waitForApproval(scripted([{ status: "expired_token" }]).input),
      EXIT_CODES.expired,
      true,
    );
    expectEnded(
      await waitForApproval(scripted([{ status: "not_found" }]).input),
      EXIT_CODES.expired,
      true,
    );
    expectEnded(
      await waitForApproval(scripted([{ status: "access_denied" }]).input),
      EXIT_CODES.denied,
      true,
    );
    const lapsed = scripted([APPROVED], { expiresAt: 4_000 });
    expectEnded(await waitForApproval(lapsed.input), EXIT_CODES.expired, true);
    expect(lapsed.polls()).toBe(0);
  });

  it("ends without spending the code when setup is off or the API keeps failing", async () => {
    const off = await waitForApproval(
      scripted([{ status: "unavailable" }]).input,
    );
    expectEnded(off, EXIT_CODES.failure, false);
    expect(off.status === "ended" && off.error.message).toContain(
      "isn't available on this Lemma environment",
    );

    const failure: TokenPoll = {
      status: "error",
      retryable: true,
      message: "Lemma did not respond",
    };
    await expect(
      waitForApproval(scripted([failure, failure, APPROVED]).input),
    ).resolves.toMatchObject({ status: "approved" });
    const failing = scripted([failure]);
    expectEnded(
      await waitForApproval(failing.input),
      EXIT_CODES.failure,
      false,
    );
    expect(failing.polls()).toBe(MAX_CONSECUTIVE_POLL_FAILURES);

    const refused = scripted([
      {
        status: "error",
        retryable: false,
        message: "Too many login polling attempts",
      },
    ]);
    const outcome = await waitForApproval(refused.input);
    expectEnded(outcome, EXIT_CODES.failure, false);
    expect(refused.polls()).toBe(1);
  });
});
