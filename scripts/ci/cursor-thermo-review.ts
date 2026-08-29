import { pathToFileURL } from "node:url";

import {
  createCursorAgentClient,
  type CursorAgentClient,
} from "./cursor-agent-api";
import {
  THERMO_REVIEW_MARKER,
  buildInfrastructureFailureComment,
  buildReviewPrompt,
  buildRunningComment,
} from "./cursor-thermo-output";
import {
  createGitHubReviewClient,
  type GitHubReviewClient,
} from "./github-review-api";

export type { GitHubReviewClient } from "./github-review-api";

export const THERMO_STATUS_CONTEXT = "Thermo-Nuclear Review";
export const THERMO_MODEL_ID = "composer-2.5";

export type ThermoReviewConfig = {
  repository: string;
  repoUrl: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  headSha: string;
  runUrl: string;
  statusToken: string;
  commentAuthor?: string;
};

export type ThermoLaunchOutcome = {
  launched: boolean;
  reason?: string;
};

export async function launchThermoReview({
  config,
  cursor,
  github,
}: {
  config: ThermoReviewConfig;
  cursor: CursorAgentClient;
  github: GitHubReviewClient;
}): Promise<ThermoLaunchOutcome> {
  let review: Awaited<ReturnType<CursorAgentClient["createAgent"]>>;

  try {
    await github.createCommitStatus({
      sha: config.headSha,
      state: "pending",
      targetUrl: config.prUrl,
      description: "Cursor thermo-nuclear review is starting",
      context: THERMO_STATUS_CONTEXT,
    });

    review = await cursor.createAgent({
      name: agentName(config.prTitle),
      prompt: { text: buildReviewPrompt(config) },
      model: { id: THERMO_MODEL_ID },
      repos: [{ url: config.repoUrl, prUrl: config.prUrl }],
      autoCreatePR: false,
      skipReviewerRequest: true,
      workOnCurrentBranch: false,
      mode: "agent",
      envVars: {
        GITHUB_STATUS_TOKEN: config.statusToken,
        GITHUB_REPOSITORY: config.repository,
        GITHUB_PR_NUMBER: String(config.prNumber),
        GITHUB_PR_URL: config.prUrl,
        GITHUB_HEAD_SHA: config.headSha,
        GITHUB_STATUS_CONTEXT: THERMO_STATUS_CONTEXT,
        GITHUB_PR_COMMENT_MARKER: THERMO_REVIEW_MARKER,
        ...(config.commentAuthor
          ? { GITHUB_COMMENT_AUTHOR: config.commentAuthor }
          : {}),
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await github
      .createCommitStatus({
        sha: config.headSha,
        state: "failure",
        targetUrl: config.runUrl,
        description: "Cursor thermo-nuclear review launch failed",
        context: THERMO_STATUS_CONTEXT,
      })
      .catch((statusError) => {
        console.error(
          "Failed to mark thermo-nuclear review status failed:",
          statusError,
        );
      });
    await github
      .upsertComment(
        buildInfrastructureFailureComment(
          config.headSha,
          reason,
        ),
      )
      .catch((commentError) => {
        console.error(
          "Failed to update thermo-nuclear review comment:",
          commentError,
        );
      });
    return { launched: false, reason };
  }

  await github
    .createCommitStatus({
      sha: config.headSha,
      state: "pending",
      targetUrl: review.agent.url,
      description: "Cursor thermo-nuclear review is running",
      context: THERMO_STATUS_CONTEXT,
    })
    .catch((statusError) => {
      console.error(
        "Failed to update thermo-nuclear review running status:",
        statusError,
      );
    });
  await github
    .ensureComment(buildRunningComment(config.headSha))
    .catch((commentError) => {
      console.error(
        "Failed to update thermo-nuclear review running comment:",
        commentError,
      );
    });

  return { launched: true };
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    if (name === "CURSOR_VALIDATION_STATUS_TOKEN") {
      throw new Error(
        "Missing required environment variable: CURSOR_VALIDATION_STATUS_TOKEN. " +
          "Configure a long-lived fine-grained token with Commit statuses and Pull requests read/write access; " +
          "the built-in GITHUB_TOKEN expires when this launcher exits.",
      );
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * The Cursor agents API rejects a name over 100 characters outright, failing
 * the whole check, so a conventional-commit title with a scope and a ticket
 * suffix must be elided rather than passed through.
 */
const AGENT_NAME_LIMIT = 100;

function agentName(prTitle: string): string {
  const composed = `Review for "${prTitle}"`;
  if (composed.length <= AGENT_NAME_LIMIT) {
    return composed;
  }
  return `${composed.slice(0, AGENT_NAME_LIMIT - 1)}\u2026`;
}

async function main() {
  const config: ThermoReviewConfig = {
    repository: requireEnv("GITHUB_REPOSITORY"),
    repoUrl: requireEnv("REPO_URL"),
    prNumber: Number.parseInt(requireEnv("PR_NUMBER"), 10),
    prTitle: requireEnv("PR_TITLE"),
    prUrl: requireEnv("PR_URL"),
    headSha: requireEnv("PR_HEAD_SHA"),
    runUrl: requireEnv("GITHUB_RUN_URL"),
    statusToken: requireEnv("CURSOR_VALIDATION_STATUS_TOKEN"),
    commentAuthor: process.env.LEMMA_PUBLISHER_BOT_LOGIN,
  };
  if (!Number.isInteger(config.prNumber) || config.prNumber <= 0) {
    throw new Error(`Invalid PR_NUMBER value: ${process.env.PR_NUMBER}`);
  }

  const outcome = await launchThermoReview({
    config,
    cursor: createCursorAgentClient({
      apiKey: requireEnv("CURSOR_API_KEY"),
    }),
    github: createGitHubReviewClient({
      token: config.statusToken,
      repository: config.repository,
      prNumber: config.prNumber,
      marker: THERMO_REVIEW_MARKER,
      commentAuthor: config.commentAuthor,
    }),
  });

  if (!outcome.launched) {
    console.error(outcome.reason);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
