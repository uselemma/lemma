# Lemma Agent Skills

[Agent Skills](https://github.com/anthropics/skills) that teach AI coding assistants (Cursor, Claude Code, Windsurf, etc.) how to correctly integrate [Lemma](https://docs.uselemma.ai) — AI observability.

## Skills

| Skill | Description |
|---|---|
| [`lemma-tracing`](./lemma-tracing/SKILL.md) | Integrate Lemma tracing into any codebase — supports the direct SDK, Vercel AI SDK v6/v7, OpenAI Agents SDK, LangChain, LangGraph, Langfuse side-by-side installs, trace handles, debug mode, and manual instrumentation |
| [`lemma-diagnostics`](./lemma-diagnostics/SKILL.md) | Improve the quality of traces already landing in Lemma — audit local instrumentation, score received shape against live docs, and hand off apply-work to `lemma-tracing` |
| [`lemma-mcp`](./lemma-mcp/SKILL.md) | Drive the Lemma MCP from the terminal — triage issues, read occurrence evidence, and record confirm / dismiss / resolve verdicts with explicit user consent |
| [`lemma-artifacts`](./lemma-artifacts/SKILL.md) | Read a codebase and record what its agents are for in Lemma — tell production agents from examples, propose claims with the evidence behind them, and write agent understanding and context files only after the user approves the specifics |

## Installation

### Skills CLI

```bash
npx skills add uselemma/lemma --skill "lemma-tracing"
npx skills add uselemma/lemma --skill "lemma-diagnostics"
npx skills add uselemma/lemma --skill "lemma-mcp"
npx skills add uselemma/lemma --skill "lemma-artifacts"
```

### Cursor

```bash
npx skills add uselemma/lemma --skill "lemma-tracing" --target cursor
npx skills add uselemma/lemma --skill "lemma-diagnostics" --target cursor
npx skills add uselemma/lemma --skill "lemma-mcp" --target cursor
npx skills add uselemma/lemma --skill "lemma-artifacts" --target cursor
```

Or install manually into your project's `.cursor/rules/` directory:

```bash
mkdir -p .cursor/rules
curl -o .cursor/rules/lemma-tracing.md \
  https://raw.githubusercontent.com/uselemma/lemma/main/skills/lemma-tracing/SKILL.md
```

### Claude Code

```bash
npx skills add uselemma/lemma --skill "lemma-tracing" --target claude
npx skills add uselemma/lemma --skill "lemma-diagnostics" --target claude
npx skills add uselemma/lemma --skill "lemma-mcp" --target claude
npx skills add uselemma/lemma --skill "lemma-artifacts" --target claude
```

## Usage

Once installed, the agent will automatically use these skills when relevant — for example:

- Adding Lemma tracing to a new or existing project
- Choosing the right path for Vercel AI SDK, OpenAI Agents SDK, LangChain, LangGraph, or manual SDK tracing
- Adding Lemma tracing alongside existing Langfuse or OpenTelemetry instrumentation
- Debugging instrumentation issues
- Auditing the shape of traces already in Lemma ("are these traces high quality?")
- Triaging Lemma issues from the terminal ("any urgent lemma issues?", bulk dismiss / validate)
- Telling Lemma what an agent is for by reading the codebase ("record what this agent does in Lemma"), before any traces exist

## Versioning

Skills follow [SemVer](https://semver.org/). Bump `metadata.version` in each changed skill's `SKILL.md` in the same PR. See [CONTRIBUTING.md](../CONTRIBUTING.md).
