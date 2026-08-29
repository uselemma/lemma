# Cursor Thermo-Nuclear Review

The `Cursor Thermo-Nuclear Review` workflow runs for every same-repository pull
request that is ready for review. Its fire-and-forget launcher creates a pending
commit status, starts one read-only Cursor Cloud Agent, ensures an idempotent
review comment exists without replacing prior findings, and exits. The agent applies the repository's
`thermo-nuclear-code-quality-review` skill and completes the status and comment.

## Required configuration

Add these GitHub Actions secrets:

- `CURSOR_API_KEY`: Cursor user or service-account API key with access to this
  repository.
- `CODE_REVIEW_PUBLISHER_CLIENT_ID` and `CODE_REVIEW_PUBLISHER_PRIVATE_KEY`:
  the `lemma-code-review-publisher` GitHub App. The launcher mints a one-hour
  installation token, skips revoke-on-job-end so the token survives after the
  launcher exits, and gives only that token to Cursor. The private key never
  enters the agent.

The built-in `GITHUB_TOKEN` expires when the launcher exits, so it cannot be
used by the Cursor agent to complete the asynchronous review. The workflow's
own Actions permissions are read-only. Comments and `Thermo-Nuclear Review`
statuses are authored by `lemma-code-review-publisher[bot]`. Existing comments
posted by a personal PAT are left in place; the bot starts a new marked
comment rather than editing another user's thread.

After the workflow has run once, require the `Thermo-Nuclear Review` commit
status in the `main` branch protection rules. Do not require the short-lived
`Launch Thermo-Nuclear Review` Actions job as the merge gate.

## Verdicts

- `PASS` succeeds the required check.
- `REQUEST_CHANGES` reports actionable findings and fails the required check.
- `BLOCKED`, malformed output, timeouts, cancelled or failed Cursor runs, and
  API errors fail closed. Errors the agent can handle are reported as a failed
  status; an agent that terminates before updating GitHub leaves the status
  pending, which still blocks merging.

The reviewer is strictly read-only. It never edits files, launches a fixer,
creates a branch, or opens a pull request. Its final PR comment includes the
verdict and a Markdown checklist of actionable findings. On each push, the next review preserves the checklist, checks off findings
that are fixed, leaves unresolved findings unchecked, and adds newly discovered
findings without duplicating existing items. The check passes only when no
unchecked findings remain.

## Security and lifecycle

The workflow uses `pull_request_target` but checks out only the PR base SHA, so
untrusted PR code cannot alter the launcher before secrets are loaded. Fork PRs
are skipped because they cannot safely receive the Cursor or GitHub credentials.

Runs are serialized by original PR number. A new push cancels the old Actions
run. Cursor agents started by a cancelled Actions run may continue in Cursor
Cloud, but the review prompt forbids repository writes and every status/comment
identifies the exact reviewed head SHA.
