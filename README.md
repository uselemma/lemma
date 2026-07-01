# Lemma

Public developer resources for Lemma AI observability.

This repository contains the user-facing SDKs, documentation source, and agent
skills for integrating Lemma tracing into AI applications.

## What is here

| Path | Contents |
| --- | --- |
| [`docs/`](docs) | Mintlify documentation source for [docs.uselemma.ai](https://docs.uselemma.ai). |
| [`packages/ts/tracing`](packages/ts/tracing) | TypeScript SDK: `@uselemma/tracing`. |
| [`packages/py/tracing`](packages/py/tracing) | Python SDK: `uselemma-tracing`. |
| [`skills/lemma-tracing`](skills/lemma-tracing) | Lemma tracing skill for adding tracing to codebases. |

## Install

```bash
npm install @uselemma/tracing
```

```bash
pip install uselemma-tracing
```

Both SDKs read credentials from environment variables by default:

```bash
export LEMMA_API_KEY=...
export LEMMA_PROJECT_ID=...
```

## Documentation

- [Quickstart](https://docs.uselemma.ai/getting-started/quickstart)
- [Tracing overview](https://docs.uselemma.ai/tracing/overview)
- [Trace contract](https://docs.uselemma.ai/reference/trace-contract)
- [Vercel AI SDK](https://docs.uselemma.ai/integrations/vercel-ai)
- [OpenAI Agents SDK](https://docs.uselemma.ai/integrations/openai-agents)
- [LangChain](https://docs.uselemma.ai/integrations/langchain)
- [LangGraph](https://docs.uselemma.ai/integrations/langgraph)

## Development

Install dependencies:

```bash
pnpm install
uv sync
```

Run TypeScript checks:

```bash
pnpm --filter @uselemma/tracing test
pnpm --filter @uselemma/tracing type-check
pnpm --filter @uselemma/tracing build
```

Run Python checks:

```bash
uv run --project packages/py/tracing --extra dev pytest packages/py/tracing/tests
uv build --package uselemma-tracing
```

Validate the docs config:

```bash
python3 -m json.tool docs/docs.json >/dev/null
```

## Releases

Package publishing is driven by package version changes on `main`.

- Changes to `packages/ts/tracing/package.json` publish `@uselemma/tracing`
  when the version is not already present on npm.
- Changes to `packages/py/tracing/pyproject.toml` publish
  `uselemma-tracing` when the version is not already present on PyPI.

## License

MIT
