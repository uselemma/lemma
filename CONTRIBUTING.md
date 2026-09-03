# Contribute to Lemma

Thank you for contributing.

## How to contribute

Check [open and closed issues](https://github.com/uselemma/lemma/issues?q=is%3Aissue) for anything similar. Comment on an existing issue if you have more context. Open a new issue for a bug or a change that needs discussion.

To contribute code: fork the repo, develop locally, and open a pull request against `main`. After it merges, you are added to the [contributors table](README.md#contributing) in the README. This project follows the [all-contributors](https://allcontributors.org) specification.

### Pull requests

Until the PR merges, the author:

1. **Keeps the branch up to date with `main`.** Merge `origin/main` (or `upstream/main` from a fork), or use GitHub's **Update branch** button. Do not leave merge conflicts.
2. **Resolves every review comment.** Thermo-Nuclear Review runs on ready PRs, plus human review. Fix it or reply on the thread; do not leave comments unanswered.
3. **Keeps every CI check green.** Path-filtered plugin workflows that do not run are fine; anything that does run must pass. Push a fix for failures. Re-run only when the failure is infrastructure.

Mark the PR **Ready for review** when you want it reviewed. Drafts skip Thermo-Nuclear Review.

On a fork PR, enable **Allow edits from maintainers** so maintainers can update the branch.

Changes to packages (`packages/`, `plugins/`) and skills (`skills/`) follow [SemVer](https://semver.org/). Bump every affected version in the same PR:

| Path | Version field |
| --- | --- |
| `packages/ts/tracing` | `package.json` |
| `packages/py/tracing` | `pyproject.toml` and `uv.lock` |
| `plugins/<name>` | `package.json` |
| `skills/<name>` | `SKILL.md` `metadata.version` |

A merge that does not bump the version does not publish.

Do not commit generated plugin `runtime/` or `scripts/` bundles. CI builds them.

## Development

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
