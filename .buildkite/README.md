# Buildkite and the lemma SDK repo

npm (`@uselemma/tracing`) and PyPI (`uselemma-tracing`) **trusted publishing**
uses GitHub OIDC and is not supported by Buildkite.

**Decision (per migration plan):** keep
[`.github/workflows/publish-ts-tracing.yml`](../.github/workflows/publish-ts-tracing.yml)
and
[`.github/workflows/publish-py-tracing.yml`](../.github/workflows/publish-py-tracing.yml)
on GitHub Actions permanently. Do **not** disable them during Buildkite cutover.

If zero-GHA dependency is required later, switch to granular npm automation +
PyPI API tokens stored in AWS Secrets Manager and add pipelines here.
