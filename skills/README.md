# Lemma Agent Skills

[Agent Skills](https://github.com/anthropics/skills) that teach AI coding assistants (Cursor, Claude Code, Windsurf, etc.) how to correctly integrate [Lemma](https://docs.uselemma.ai) — AI observability.

## Skills

| Skill | Description |
|---|---|
| [`lemma-tracing`](./lemma-tracing/SKILL.md) | Integrate Lemma tracing into any codebase — supports the direct SDK, Vercel AI SDK v6/v7, OpenAI Agents SDK, LangChain, LangGraph, Langfuse side-by-side installs, trace handles, debug mode, and manual instrumentation |

## Installation

### Skills CLI

```bash
npx skills add uselemma/lemma --skill "lemma-tracing"
```

### Cursor

```bash
npx skills add uselemma/lemma --skill "lemma-tracing" --target cursor
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
```

## Usage

Once installed, the agent will automatically use these skills when relevant — for example:

- Adding Lemma tracing to a new or existing project
- Choosing the right path for Vercel AI SDK, OpenAI Agents SDK, LangChain, LangGraph, or manual SDK tracing
- Adding Lemma tracing alongside existing Langfuse or OpenTelemetry instrumentation
- Debugging instrumentation issues

## Versioning

Skills are versioned alongside Lemma's tracing docs. When the recommended instrumentation or export path changes, the skill is updated in the same PR so agents generate up-to-date code.
