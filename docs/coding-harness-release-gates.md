# Coding harness release gates

The coding harness integrations have two separate release layers.

## Repository-ready

Work that can be completed without third-party release access:

- Build the native harness adapter and project-scoped Lemma authorization.
- Redact secrets before persistence or delivery.
- Retain failed deliveries for retry.
- Verify type checks, tests, generated runtime files, and packed package contents.
- Verify clean installation from a checkout or packed tarball.
- Prepare manifests, install instructions, screenshots, listing copy, and release checklists.

## Externally gated

Work that must wait for the relevant publisher account or organization access:

- First publication under the `@uselemma` npm organization.
- Trusted-publisher registration in npm after the package exists.
- Submission to a centralized plugin directory or marketplace.
- Final public-install verification from the approved listing or npm registry.

Local plugin verification is not a substitute for the final public path, but it proves the implementation and installer independently of those external gates.

## Distribution by harness

- Claude Code: repository marketplace during development; public marketplace submission later.
- Codex: local marketplace during development; universal plugin directory submission later.
- Cursor: local plugin checkout during development; public plugin listing later.
- Pi, Hermes, OpenClaw: packed npm package verification now; public npm publication later.
- OpenCode: global local plugin file or packed package verification now; public npm and ecosystem listing later.
