---
name: lemma-artifacts
description: >-
  Read this codebase and record what its AI agents are for in Lemma. Use when
  the user asks to tell Lemma about their agent, set up or improve Lemma
  artifacts or agent context, record what an agent does, describe their agent
  to Lemma, or fix a rule Lemma still has that the codebase no longer
  enforces. After its
  closing report it offers to hand off to lemma-tracing when the agent it
  settled on is not instrumented, whether or not anything was written. Do not
  use for installing tracing or fixing trace delivery and shape — that is
  lemma-tracing and lemma-diagnostics.
metadata:
  version: 3.0.0
---

# Lemma Artifacts

You are recording, in Lemma, what the AI agents in this codebase are for.

Lemma detects failures in production agents by reading their traces. It reads
them better when it knows what the agent was supposed to do. That knowledge
normally accrues from traces over time, which means the earliest traces are
judged with no context at all, and some of it never shows up in a trace. This
skill records that part from the source the customer already has: their own
code.

Two things follow from where you are standing, and they govern everything below.

**The code tells you intent, not behaviour.** You are reading what the authors
meant to build. Only traces show what actually happens, so leave out anything
only a run could tell you: the shape of a trace, latencies, call counts.

**Nothing is written without the user saying yes to specifics.** You are about
to put words in their vendor's mouth about their own system. They get to read
those words first, every time.

## Core rules

1. **Read Lemma's current state before proposing anything.** Call
   `list_project_artifacts` with the settled agent name first, always —
   including when you expect it to be empty. What is already recorded changes
   what is worth adding.
2. **Never call a write tool before the user has approved that specific
   content in this conversation.** `upload_project_artifact` and
   `delete_project_artifact` both wait for an explicit yes.
3. **Itemize the claims in the confirmation.** "Write 3 artifacts?" is not a
   confirmation. Name the agent, state the claims, and say which file each
   would land in. See [references/record.md](references/record.md).
4. **Never modify the user's code.** You are reading their repository to
   describe it. No edits, no new files, no reformatting — not even to a
   README, and not to "fix" something you noticed. Mention it and move on.
5. **Never touch the key.** You reach Lemma with `LEMMA_MCP_API_KEY`, which
   the user sets in the environment you run in. Reference it by name only.
   Never read, print, echo, or write its value into any file, tracked or not,
   and never ask the user to paste it into this conversation. A placeholder
   line such as `LEMMA_MCP_API_KEY=` in an env example is fine. If it is
   missing, see [When Lemma refuses the connection](#when-lemma-refuses-the-connection).
6. **Never write the agent understanding, and never call
   `regenerate_project_artifacts`.** Lemma writes the understanding itself.
   Regenerating starts Lemma's own learning run, which costs real time and
   money, and starting one is the user's decision to make in the dashboard.
7. **Only replace or delete a file this run uploaded, or one the user named.**
   Every other uploaded file is read-only to you, whatever its name or
   content. A project's uploads also hold runbooks and custom pricing
   schedules that this skill did not write and cannot judge.
8. **Say what convinced you.** Every proposed claim cites the file that
   supports it. A claim you cannot point at is a claim you should drop.
9. Keep tool names exactly as written here so transport mappings stay valid.

## Two kinds of artifact, and you write only one

Lemma stores two things and the word "artifact" is used loosely for both. They
behave differently, and this skill reads both but writes only the second.

| | Agent understanding | Project context files |
| --- | --- | --- |
| Holds | how the agent works: its task and its tools | facts no trace shows: rules, intended behaviour that looks like a failure, setup facts |
| Written by | Lemma's learning runs, from traces and from the context files | the customer, and you |
| Rewritten by Lemma | on every learning run | never |
| Your tools | read only: `list_project_artifacts`, `get_project_artifact`, `get_agent_understanding_history` | `upload_project_artifact`, `delete_project_artifact`, and `get_project_artifact` to read |
| Contract | [references/agent-artifact-contract.md](references/agent-artifact-contract.md), for reading what Lemma wrote | [references/project-context-contract.md](references/project-context-contract.md) |

**You do not write the understanding.** There is no tool for it. Lemma writes
it from traces once they arrive, and reads the project's context files when it
does. What the agent is for, which tools it calls and in what order are all
things a trace shows, so leave them to that run and say so to the user.

Which findings you record is decided by one test, set out with examples in
[references/project-context-contract.md](references/project-context-contract.md):
**could someone learn this from the agent's traces, including the system prompt
they carry?** If not, it goes in a project context file. If so, it is Lemma's
to learn, and you do not record it.

A project with no traces yet has no understanding. Lemma writes the first one
after the agent's first traces arrive. That is a normal state, not something
for you to fill.

## Workflows

| Step | When | Reference |
| --- | --- | --- |
| Discover | Find the real agents, tell them from examples and dead code, settle their names | [references/discover.md](references/discover.md) |
| Record | Read current state, propose, confirm, upload, report | [references/record.md](references/record.md) |
| Hand off | After the closing report, offer tracing when the settled target agent is not instrumented — written or declined | [references/tracing-handoff.md](references/tracing-handoff.md) |

Read all three before acting. Run them in that order.

## When Lemma refuses the connection

A `401` from any Lemma tool means the key behind `LEMMA_MCP_API_KEY` is
missing, expired, or revoked. It is a thing for the user to fix, never a thing
to work around.

Stop there. Write nothing, offer nothing, and tell the user to set
`LEMMA_MCP_API_KEY` in the environment this agent runs in, then run you again.
A key comes from the **Describe your agent** step in Lemma onboarding, or from
**Settings → API keys** in the dashboard.

Do not ask them to paste the key to you. Do not read it back out of a file or
the environment to check it. Do not retry the call until they say it is set.

## When this is not the right skill

- The user wants tracing installed, or traces are not arriving: hand off to
  `lemma-tracing`. Do not install the SDK yourself. The one time this skill
  raises tracing on its own is the offer after the closing report
  ([references/tracing-handoff.md](references/tracing-handoff.md)): the offer
  is a question, and the work is still `lemma-tracing`'s.
- Traces arrive but are thin or malformed: hand off to `lemma-diagnostics`.
- The user wants to triage detected issues: that is `lemma-mcp`.

This skill does not need traces to exist. Recording specification before the
first trace is the point of it, so an empty project is a normal starting state,
not a blocker.
