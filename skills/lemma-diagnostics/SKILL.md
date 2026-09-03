---
name: lemma-diagnostics
description: >-
  Improve the quality of Lemma traces that are already landing. Use when the
  user asks whether traces are high quality, why a Lemma trace is missing
  tools, generations, or thread ids, to improve agent instrumentation, to
  audit the shape of traces already in Lemma, or whether traces match the
  high-quality traces guide. Do not use for first-time setup or missing
  delivery — that is lemma-tracing.
---

# Lemma Diagnostics

You are reviewing instrumentation quality for traces that already exist in
Lemma. You never edit the customer's app. Apply-work and delivery debug stay
with `lemma-tracing`.

## Core rules

1. Never write, patch, or generate application code. Diagnosis and a fix
   plan only.
2. If traces are not confirmed in Lemma, stop and hand off to
   `lemma-tracing`. Do not enable debug mode or chase ingest.
3. Never show the user a raw UUID or raw JSON. Render traces as an 8-char
   id prefix plus a list ordinal, e.g. `[2] a3f81c92`.
4. Keep MCP tool names exactly as written
   (`has_ready_traces`, `list_dashboard_traces`, `get_trace`,
   `list_trace_spans`) so transport mappings stay valid.
5. Do not paste the trace contract, quality rubric, or adapter recipes from
   memory. Fetch the live docs, then score received traces against those
   pages. Cite the page and heading for each finding.

## Workflows

| Area | When | Reference |
| --- | --- | --- |
| Audit | Confirm traces exist, detect the local harness, name the supported path | [references/audit.md](references/audit.md) |
| Verify | Fetch received traces, crawl docs, score quality, present a plan | [references/verify.md](references/verify.md) |

Read both references before acting. Run audit first.

## Docs

Base URL: `https://docs.uselemma.ai`

Fetch these before scoring a received trace. Do not copy their bodies into
notes or into this skill.

1. `https://docs.uselemma.ai/llms.txt`
2. `https://docs.uselemma.ai/reference/trace-contract.md`
3. `https://docs.uselemma.ai/guides/building-high-quality-traces.md`
4. `https://docs.uselemma.ai/guides/instrumenting-multi-turn-agents.md`
5. `https://docs.uselemma.ai/tracing/instrumentation/cross-process-turns.md`
6. `https://docs.uselemma.ai/tracing/troubleshooting/common-issues.md`
   (shape and quality symptoms only)
7. The matching first-wave integration page, plus setup / traces /
   generations / tool-calls / spans / context as needed:
   - Vercel AI SDK: `https://docs.uselemma.ai/integrations/vercel-ai.md`
   - OpenAI Agents SDK: `https://docs.uselemma.ai/integrations/openai-agents.md`
   - LangChain: `https://docs.uselemma.ai/integrations/langchain.md`
   - LangGraph: `https://docs.uselemma.ai/integrations/langgraph.md`
   - Mastra: `https://docs.uselemma.ai/integrations/mastra.md`
   - Setup: `https://docs.uselemma.ai/tracing/instrumentation/setup.md`
   - Traces: `https://docs.uselemma.ai/tracing/instrumentation/traces.md`
   - Generations: `https://docs.uselemma.ai/tracing/instrumentation/generations.md`
   - Tool calls: `https://docs.uselemma.ai/tracing/instrumentation/tool-calls.md`
   - Spans: `https://docs.uselemma.ai/tracing/instrumentation/spans.md`
   - Context: `https://docs.uselemma.ai/tracing/instrumentation/context.md`

Do not fetch debug mode. Missing delivery is `lemma-tracing`.

## First-wave paths

Recommend the matching Lemma SDK adapter. Never recommend generic OTLP.

- Direct `@uselemma/tracing` / `uselemma-tracing`
- Vercel AI SDK `vercelAI()`
- OpenAI Agents SDK
- LangChain / LangGraph callbacks
- Mastra exporter

Unrecognized harnesses get an honest gap report and a manual-SDK plan.

## Handoff

If a code change is required, stop and point at `lemma-tracing`. If MCP is
disconnected or credentials are missing, say so and do not invent a
dashboard result.
