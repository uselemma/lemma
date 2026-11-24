# Lemma Agent Skills

[Agent Skills](https://github.com/anthropics/skills) that teach AI coding assistants (Cursor, Claude Code, Windsurf, etc.) how to correctly integrate [Lemma](https://docs.uselemma.ai) — AI observability.

## Skills

| Skill | Description |
|---|---|
| [`lemma-setup`](./lemma-setup/SKILL.md) | Set up Lemma from the dashboard's setup prompt — infer the project and agent names, ask the Approach and Scope questions, approve the connection in the browser with `npx @uselemma/setup`, instrument with `lemma-tracing`, connect the Lemma MCP server, and record the first agent context |
| [`lemma-tracing`](./lemma-tracing/SKILL.md) | Integrate Lemma tracing into any codebase — supports the direct SDK, Vercel AI SDK v6/v7, OpenAI Agents SDK, LangChain, LangGraph, Langfuse side-by-side installs, trace handles, debug mode, and manual instrumentation |
| [`lemma-diagnostics`](./lemma-diagnostics/SKILL.md) | Improve the quality of traces already landing in Lemma — audit local instrumentation, score received shape against live docs, and hand off apply-work to `lemma-tracing` |
| [`lemma-mcp`](./lemma-mcp/SKILL.md) | Drive the Lemma MCP from the terminal — find and read issues, check traces and monitors, and choose the right action (lifecycle, metadata, monitor correction, or ticket) within what the user authorized |
| [`lemma-analytics`](./lemma-analytics/SKILL.md) | Answer questions about production numbers with the analytics API — volume, latency, tool failures, and estimated cost by agent, model, tool, or day, over the Lemma MCP or REST |
| [`lemma-artifacts`](./lemma-artifacts/SKILL.md) | Read a codebase and record in Lemma the facts about its agents that no trace shows — tell production agents from examples, propose claims with the evidence behind them, and upload context files only after the user approves the specifics. Lemma generates the agent understanding itself from traces — then, after its closing report, offer to hand off to `lemma-tracing` when the agent it settled on is not instrumented, uploaded or not |

## Installation

### Skills CLI

```bash
npx skills add uselemma/lemma --skill "lemma-tracing"
npx skills add uselemma/lemma --skill "lemma-diagnostics"
npx skills add uselemma/lemma --skill "lemma-mcp"
npx skills add uselemma/lemma --skill "lemma-analytics"
npx skills add uselemma/lemma --skill "lemma-artifacts"
```

### Cursor

```bash
npx skills add uselemma/lemma --skill "lemma-tracing" --agent cursor
npx skills add uselemma/lemma --skill "lemma-diagnostics" --agent cursor
npx skills add uselemma/lemma --skill "lemma-mcp" --agent cursor
npx skills add uselemma/lemma --skill "lemma-analytics" --agent cursor
npx skills add uselemma/lemma --skill "lemma-artifacts" --agent cursor
```

Or install manually into your project's `.cursor/skills/` directory. Copy each skill's whole folder, because `SKILL.md` links to the reference files beside it:

```bash
git clone --depth 1 https://github.com/uselemma/lemma.git lemma-src
mkdir -p .cursor/skills
cp -R lemma-src/skills/lemma-* .cursor/skills/
rm -rf lemma-src
```

### Claude Code

```bash
npx skills add uselemma/lemma --skill "lemma-tracing" --agent claude-code
npx skills add uselemma/lemma --skill "lemma-diagnostics" --agent claude-code
npx skills add uselemma/lemma --skill "lemma-mcp" --agent claude-code
npx skills add uselemma/lemma --skill "lemma-analytics" --agent claude-code
npx skills add uselemma/lemma --skill "lemma-artifacts" --agent claude-code
```

## Usage

Once installed, the agent will automatically use these skills when relevant — for example:

- Adding Lemma tracing to a new or existing project
- Choosing the right path for Vercel AI SDK, OpenAI Agents SDK, LangChain, LangGraph, or manual SDK tracing
- Adding Lemma tracing alongside existing Langfuse or OpenTelemetry instrumentation
- Debugging instrumentation issues
- Auditing the shape of traces already in Lemma ("are these traces high quality?")
- Triaging Lemma issues from the terminal ("any urgent lemma issues?", bulk dismiss / validate)
- Answering questions about production numbers ("which tools fail most this week?", "what did gpt-4o cost us?")
- Telling Lemma what an agent is for by reading the codebase ("record what this agent does in Lemma"), before any traces exist

## Versioning

Skills follow [SemVer](https://semver.org/). Bump `metadata.version` in each changed skill's `SKILL.md` in the same PR. See [CONTRIBUTING.md](../CONTRIBUTING.md).
