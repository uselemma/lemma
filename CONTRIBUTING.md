# Contribute to Lemma

Thank you for contributing.

## How to contribute

Check [open and closed issues](https://github.com/uselemma/lemma/issues?q=is%3Aissue) for anything similar. Comment on an existing issue if you have more context. Open a new issue for a bug or a change that needs discussion.

To contribute code: fork the repo, develop locally, and open a pull request against `main`. This project follows the [all-contributors](https://allcontributors.org) specification. After a PR merges, a maintainer adds the author to the [README table](README.md#contributing):

```bash
npx all-contributors-cli add <github-username> code
```

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
| `plugins/lemma-*` | `package.json` |
| `skills/<name>` | `SKILL.md` `metadata.version` |

npm and PyPI publish only when a published package's version field changes on `main`. Skill `metadata.version` is for traceability; skills are not published.

Do not commit generated plugin bundles. Paths differ by plugin (`runtime/`, `scripts/`, Hermes `hermes-plugin/lemma/runtime/`, Pi `extensions/`). See each plugin README and `.gitignore`. CI builds them.

## Releases

Package publishing is driven by package version changes on `main`.

- Changes to `packages/ts/tracing/package.json` publish `@uselemma/tracing` on npm when the version is not already present.
- Changes to `packages/py/tracing/pyproject.toml` publish `uselemma-tracing` on PyPI when the version is not already present.
- Changes to `plugins/lemma-pi/package.json`, `plugins/lemma-hermes/package.json`, `plugins/lemma-openclaw/package.json`, or `plugins/lemma-opencode/package.json` publish `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw`, or `@uselemma/opencode` on npm when the version is not already present.

Private plugins (`lemma-codex`, `lemma-cursor`, `lemma-claude-code`) still bump SemVer; they are not npm-published.

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

Plugin packages use `pnpm --filter <package> type-check`, `test`, and `build`. Examples: `@uselemma/codex-plugin`, `@uselemma/opencode`, `@uselemma/pi`. See each plugin README.

If you edit Mintlify docs, validate the config:

```bash
python3 -m json.tool docs/docs.json >/dev/null
```

## License

Contributions are licensed under [MIT](LICENSE).
