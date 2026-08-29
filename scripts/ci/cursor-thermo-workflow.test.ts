import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/cursor-thermo-review.yml", import.meta.url),
  "utf8",
);

describe("Cursor thermo-review workflow", () => {
  // The job checks out the PR's base.sha, so the launcher that runs comes from
  // the base commit rather than main. Open PRs with older bases still execute
  // launchers that read these, and dropping them broke PR #759 (ENG-365).
  it("keeps legacy environment inputs available to older trusted launchers", () => {
    assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(
      workflow,
      /PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/,
    );
    assert.match(
      workflow,
      /CURSOR_VALIDATION_STATUS_TOKEN: \$\{\{ steps\.publisher\.outputs\.token \}\}/,
    );
  });

  it("passes the pull request title to the launcher", () => {
    assert.match(
      workflow,
      /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/,
    );
  });

  it("mints a publisher App token and never gives Cursor the private key", () => {
    assert.match(
      workflow,
      /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/,
    );
    assert.match(
      workflow,
      /client-id: \$\{\{ secrets\.CODE_REVIEW_PUBLISHER_CLIENT_ID \}\}/,
    );
    assert.match(
      workflow,
      /LEMMA_PUBLISHER_BOT_LOGIN: \$\{\{ format\('\{0\}\[bot\]', steps\.publisher\.outputs\.app-slug\) \}\}/,
    );
    assert.match(workflow, /skip-token-revoke: true/);
    const launchBlock = workflow.slice(
      workflow.indexOf("name: Launch thermo-nuclear review"),
    );
    assert.doesNotMatch(launchBlock, /CODE_REVIEW_PUBLISHER_PRIVATE_KEY/);
  });

  it("does not call the OpenHands shared workflow", () => {
    assert.match(workflow, /^name: Cursor Thermo-Nuclear Review$/m);
    assert.doesNotMatch(
      workflow,
      /uselemma\/code-review|OpenHands|openhands-shadow/,
    );
  });
});
