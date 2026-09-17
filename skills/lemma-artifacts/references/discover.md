# Find the real agents

Read-only. Do not create, edit, or delete files in the user's repository.

## Scope

If the user named a path, an agent, or a service, start there and stay there.
Ask before widening.

Otherwise scan the whole repository. Start from the places an agent is wired
up rather than reading everything: entry points, request handlers, job and
queue workers, CLI commands, workflow or graph definitions, and anywhere a
model client is constructed.

Useful signals:

| Signal | What to look for |
| --- | --- |
| Lemma SDK | `@uselemma/tracing`, `uselemma_tracing`, `withAgent`, `lemma.trace` |
| Model calls | `generateText`, `streamText`, `messages.create`, `chat.completions` |
| Agent frameworks | `@openai/agents`, LangChain, LangGraph, Mastra, Vercel AI SDK |
| Tool definitions | tool/function schemas passed to a model |
| Orchestration | retry loops, planner/executor splits, sub-agent dispatch |

Stop when you can say what each agent is for. You are not auditing the
codebase.

## Production, or not

A repository usually contains more things that look like agents than it runs.
Recording a demo as production teaches Lemma to expect behaviour that never
occurs, and that costs the user noise in their issues later.

Treat as **production** when it is reachable from something the application
actually runs — a route, a worker, a scheduled job, an exported entry point —
and nothing marks it as sample or disabled.

Treat as **not production**, and say so rather than silently dropping it:

- anything under `examples/`, `samples/`, `demo/`, `docs/`, `fixtures/`
- test files and test-only helpers
- code nothing imports, or whose only import is commented out
- work marked abandoned, deprecated, prototype, spike, or WIP in a name,
  comment, or changelog

When it is genuinely unclear, say what you found, say why you are unsure, and
let the user decide. Do not guess in either direction.

## Several candidates

If more than one production agent exists, present them all with the evidence
for each and let the user choose what to record. Do not record several agents
on one blanket approval — they are separate entries in Lemma and the user may
want only one. If the user does not choose, the run ends: see
[When discover ends the run](#when-discover-ends-the-run).

## Nothing to record

If no production agent is identifiable, say what you looked at and what you
were looking for, and **write nothing**. An empty project is a correct outcome
here. Do not record a placeholder, do not record the repository itself as an
agent, and do not record a demo because it was the only candidate.

If the repository has no AI agent in it at all, say so plainly. Either way
the run ends: see [When discover ends the run](#when-discover-ends-the-run).

## The agent's name

This matters more than it looks. Lemma files everything — traces, issues,
understanding, context — under an agent name. If the name you record does not
match the name the running code reports, the artifacts you write describe an
agent that never appears, and the real one stays uncalibrated. Nothing will
warn you; both will simply exist.

Find the name in this order:

1. **The name the user gave you.** If the prompt or the conversation states
   the agent name (Lemma's onboarding hands over a prompt that does), use it
   verbatim: that is the name their instrumentation is being set up to send,
   and the `lemma-tracing` skill's contract pins the same string as the root
   trace `name`. If the code already passes a *different* name to the Lemma
   SDK, do not pick one silently — say both names and ask which is correct
   before writing. If the supplied name plausibly fits more than one
   production candidate — an annual and a quarterly billing agent when the
   prompt says `billing-agent` — present them with the evidence for each and
   ask which one is meant. Do not pick the closer match. If the user does not
   settle it, the run ends: see
   [When discover ends the run](#when-discover-ends-the-run).
2. **The instrumentation.** Whatever the code passes to the Lemma SDK as the
   agent name is authoritative, exactly as written. Copy it character for
   character — `checkout-agent` and `CheckoutAgent` are two different agents.
3. **The names already in Lemma.** `list_project_artifacts` returns the agents
   this project knows about. If one clearly corresponds, use it rather than
   coining a variant.
4. **Ask.** If the agent is not instrumented yet, there is no fact to find.
   Propose a name, say it must match what the SDK will send, and let the user
   confirm or correct it.

Never invent a name from a class or file name when the user or the
instrumentation states one. If the agent is uninstrumented and the user has
no preference, say plainly that the name has to match whatever they configure
later, and that a mismatch means the record will not apply to their traces.

If traces exist under a name close to but not identical to the one you were
about to use, stop and ask which is correct. Unanswered, that too ends the
run.

## When discover ends the run

Discover can end the whole run, not only its own step. It does so when:

- no production agent is identifiable ([Nothing to record](#nothing-to-record));
- several candidates exist and the user does not pick one
  ([Several candidates](#several-candidates));
- a supplied name fits more than one candidate, or disagrees with the
  instrumentation, and the user does not settle it
  ([The agent's name](#the-agents-name)).

In every one of these cases, the same thing happens: say what you looked at,
what you found, and why you are stopping; **write nothing**; and do not
continue to [record.md](record.md) or [tracing-handoff.md](tracing-handoff.md).
A run that ended here has no settled production agent, so there is nothing to
propose and nothing to offer instrumentation for. Do not record a placeholder
in its place, and do not offer to instrument an agent nobody chose.
