import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CreateCursorAgentRequest,
  CursorAgentClient,
} from "./cursor-agent-api";
import {
  THERMO_MODEL_ID,
  THERMO_STATUS_CONTEXT,
  launchThermoReview,
  type GitHubReviewClient,
  type ThermoReviewConfig,
} from "./cursor-thermo-review";

const config: ThermoReviewConfig = {
  repository: "uselemma/platform",
  repoUrl: "https://github.com/uselemma/platform",
  prNumber: 42,
  prTitle: "Improve review agent names",
  prUrl: "https://github.com/uselemma/platform/pull/42",
  headSha: "abc123456789",
  runUrl: "https://github.com/uselemma/platform/actions/runs/1",
  statusToken: "long-lived-token",
};

describe("launchThermoReview", () => {
  it("launches one read-only agent and exits without polling", async () => {
    const cursor = createFakeCursor();
    const github = createFakeGitHub();

    const outcome = await launchThermoReview({ config, cursor, github });

    assert.deepEqual(outcome, { launched: true });
    assert.equal(cursor.createCalls.length, 1);
    assert.equal(
      cursor.createCalls[0]?.name,
      'Review for "Improve review agent names"',
    );
    assert.deepEqual(cursor.createCalls[0]?.model, { id: THERMO_MODEL_ID });
    assert.deepEqual(cursor.createCalls[0]?.repos, [
      { url: config.repoUrl, prUrl: config.prUrl },
    ]);
    assert.equal(cursor.createCalls[0]?.autoCreatePR, false);
    assert.equal(cursor.createCalls[0]?.workOnCurrentBranch, false);
    assert.equal(
      cursor.createCalls[0]?.envVars?.GITHUB_STATUS_TOKEN,
      config.statusToken,
    );
    assert.equal(
      cursor.createCalls[0]?.envVars?.GITHUB_STATUS_CONTEXT,
      THERMO_STATUS_CONTEXT,
    );
    assert.equal(
      cursor.createCalls[0]?.envVars?.GITHUB_COMMENT_AUTHOR,
      undefined,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /Do not edit files, commit, push, create branches, create pull requests/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /Use `success` only for PASS\. Use `failure` for REQUEST_CHANGES, BLOCKED, malformed output/,
    );
    assert.doesNotMatch(
      cursor.createCalls[0]?.prompt.text ?? "",
      /THERMO_REVIEW_RESULT/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /Preserve every prior checklist item across pushes/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /Finish GitHub writes before it expires/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /If they differ, this run is stale/,
    );
    assert.deepEqual(
      github.statuses.map(({ state, targetUrl }) => ({ state, targetUrl })),
      [
        { state: "pending", targetUrl: config.prUrl },
        { state: "pending", targetUrl: "https://cursor.test/agent-1" },
      ],
    );
    assert.match(github.comments.at(-1) ?? "", /Reviewing commit `abc1234`/);
    assert.match(github.comments.at(-1) ?? "", /## Thermo-Nuclear Review/);
    assert.doesNotMatch(github.comments.at(-1) ?? "", /Open review agent/);
    assert.doesNotMatch(
      (github.comments.at(-1) ?? "").replace(/<!--[\s\S]*?-->/g, ""),
      /\bCursor\b/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /## Thermo-Nuclear Review/,
    );
    assert.doesNotMatch(
      cursor.createCalls[0]?.prompt.text ?? "",
      /markdown link to this Cursor agent/,
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /Do not mention Cursor/,
    );
  });

  it("tells the agent to publish only as the publisher bot", async () => {
    const cursor = createFakeCursor();
    const github = createFakeGitHub();
    const outcome = await launchThermoReview({
      config: {
        ...config,
        commentAuthor: "lemma-code-review-publisher[bot]",
      },
      cursor,
      github,
    });

    assert.deepEqual(outcome, { launched: true });
    assert.equal(
      cursor.createCalls[0]?.envVars?.GITHUB_COMMENT_AUTHOR,
      "lemma-code-review-publisher[bot]",
    );
    assert.match(
      cursor.createCalls[0]?.prompt.text ?? "",
      /PATCH only a marked comment whose `user\.login` is `lemma-code-review-publisher\[bot\]`/,
    );
  });

  it("fails the launcher status and comment when agent creation fails", async () => {
    const cursor = createFakeCursor(new Error("Cursor API unavailable"));
    const github = createFakeGitHub();

    const outcome = await launchThermoReview({ config, cursor, github });

    assert.equal(outcome.launched, false);
    assert.match(outcome.reason ?? "", /Cursor API unavailable/);
    assert.deepEqual(
      github.statuses.map(({ state }) => state),
      ["pending", "failure"],
    );
    assert.match(github.comments.at(-1) ?? "", /could not launch safely/);
    assert.doesNotMatch(github.comments.at(-1) ?? "", /Open Cursor run/);
    assert.doesNotMatch(github.comments.at(-1) ?? "", /Open review agent/);
  });

  it("preserves an existing findings checklist while launching a rerun", async () => {
    const existingComment =
      "<!-- cursor-thermo-review -->\n- [ ] **High** `src/a.ts:1` — fix me";
    const cursor = createFakeCursor();
    const github = createFakeGitHub({ existingComment });

    const outcome = await launchThermoReview({ config, cursor, github });

    assert.deepEqual(outcome, { launched: true });
    assert.deepEqual(github.comments, [existingComment]);
  });

  it("stays launched when post-create status and comment updates fail", async () => {
    const cursor = createFakeCursor();
    const github = createFakeGitHub({
      failStatusAt: 2,
      failComment: true,
    });

    const outcome = await launchThermoReview({ config, cursor, github });

    assert.deepEqual(outcome, { launched: true });
    assert.equal(cursor.createCalls.length, 1);
    assert.deepEqual(
      github.statuses.map(({ state }) => state),
      ["pending", "pending"],
    );
  });
});

function createFakeCursor(createError?: Error) {
  const createCalls: CreateCursorAgentRequest[] = [];
  const client: CursorAgentClient & {
    createCalls: CreateCursorAgentRequest[];
  } = {
    createCalls,
    async createAgent(request) {
      createCalls.push(request);
      if (createError) throw createError;
      return {
        agent: {
          id: "agent-1",
          name: request.name,
          url: "https://cursor.test/agent-1",
        },
        run: { id: "run-1", agentId: "agent-1", status: "RUNNING" },
      };
    },
  };
  return client;
}

function createFakeGitHub({
  failStatusAt,
  failComment = false,
  existingComment,
}: {
  failStatusAt?: number;
  failComment?: boolean;
  existingComment?: string;
} = {}) {
  const comments: string[] = existingComment ? [existingComment] : [];
  const statuses: Array<{
    sha: string;
    state: "pending" | "success" | "failure" | "error";
    targetUrl: string;
    description: string;
    context: string;
  }> = [];
  const client: GitHubReviewClient & {
    comments: string[];
    statuses: typeof statuses;
  } = {
    comments,
    statuses,
    async ensureComment(body) {
      if (failComment) throw new Error("Comment API unavailable");
      if (comments.length === 0) comments.push(body);
    },
    async upsertComment(body) {
      if (failComment) throw new Error("Comment API unavailable");
      comments.push(body);
    },
    async createCommitStatus(input) {
      statuses.push(input);
      if (statuses.length === failStatusAt) {
        throw new Error("Status API unavailable");
      }
    },
  };
  return client;
}
