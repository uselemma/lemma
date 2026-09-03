# Contributing

## Merge bar

The pull request author owns these until merge:

1. **Keep the PR current with `main`.**
2. **Resolve every review comment.**
3. **Keep every CI check green.**

A PR that fails any of these is not ready to merge.

### Keep the PR current with `main`

Whenever `main` moves, update your branch before you ask for merge.

```bash
git fetch origin
git merge origin/main
git push
```

If you work from a fork, add this repository as `upstream` and merge `upstream/main`. GitHub's **Update branch** button is equivalent.

Do not leave the PR behind `main`. Review and CI only count on a current branch.

### Resolve every review comment

Ready (non-draft) pull requests get a Thermo-Nuclear Review. That review and any human review comments are blocking.

For each comment, either:

- Push a fix that addresses it, or
- Reply on the thread with why the code should stay as it is.

Do not leave comments unanswered. Resolve the GitHub thread after you have addressed it.

### Keep CI green

Every check shown on the pull request must pass. If a check fails, fix it on the branch and push. Re-run a check only when the failure is infrastructure, not when the test is right.

Plugin workflows are path-filtered. Checks that do not run for your paths are fine. Checks that do run must stay green.

## Open a pull request

1. Branch from current `main`. A fork is fine.
2. Add tests for behavior changes.
3. If the change ships in an SDK or harness plugin, bump that package's version in the same PR:

   | Package | Version field |
   | --- | --- |
   | `@uselemma/tracing` | `packages/ts/tracing/package.json` |
   | `uselemma-tracing` | `packages/py/tracing/pyproject.toml` and `uv.lock` |
   | `@uselemma/opencode`, `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw` | `plugins/<name>/package.json` |

   A merge that does not bump the version does not publish.

4. Open a pull request against `main` and mark it **Ready for review**. Drafts do not get Thermo-Nuclear Review.
5. Hold the merge bar above until merge.

Do not commit generated plugin `runtime/` or `scripts/` bundles. CI builds them.

## Local checks

Install:

```bash
pnpm install
uv sync
```

TypeScript SDK:

```bash
pnpm --filter @uselemma/tracing test
pnpm --filter @uselemma/tracing type-check
pnpm --filter @uselemma/tracing build
```

Python SDK:

```bash
uv run --project packages/py/tracing --extra dev pytest packages/py/tracing/tests
uv build --package uselemma-tracing
```

Plugin packages use `pnpm --filter <name> type-check`, `test`, and `build`. See each plugin README.

If you edit Mintlify docs, validate the config:

```bash
python3 -m json.tool docs/docs.json >/dev/null
```

## License

Contributions are licensed under [MIT](LICENSE).
