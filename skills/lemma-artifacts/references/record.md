# Read, propose, confirm, write

## 1. Read what Lemma already has

Always, before proposing anything:

- `list_project_artifacts` — the agents this project knows about, the current
  understanding document, and the uploaded context files.
- `list_learn_agent_artifact_versions` with the agent name — the version
  history. **The latest version number here is the precondition for writing**,
  so you need it even when you intend to write a fresh document.
- `get_learn_agent_artifact_version` — read the current document before
  proposing changes to it.
- `get_project_artifact_content` for any context file you might change. It
  returns `content_sha256`, which is the precondition for updating that file.

Never skip this because you expect the project to be empty. "Empty" is itself
a precondition you have to have read: a knowledge write on an agent with no
versions passes `expected_latest_version: null`, and that asserts you looked.

What is already there changes what you propose. Do not restate something
Lemma already records, and do not silently contradict it — if the code
disagrees with a recorded claim, that disagreement is the interesting part and
the user should hear it.

## 2. Propose, in specifics

Show the user what you intend to record, before any write. The confirmation
has to be specific enough to judge, which means:

- Name the agent, exactly as it will be recorded.
- State each claim as a sentence they can agree or disagree with.
- Say which file each claim lands in, and whether that creates something new
  or supersedes something existing.
- Cite the file that convinced you, per claim.

In the spirit of:

> I've read this codebase and I think `checkout-agent` is the production
> agent — it's the only one wired into a route (`src/server.ts`), and the two
> others are an example and a test fixture.
>
> I'd record, as its **understanding** (first version, nothing recorded yet):
> - It takes a cart and drives it to a completed order; a run ends at
>   confirmation or abandonment. (`src/checkout-agent.ts`)
> - It calls `price_cart` then `charge_card`, and reprices once after a
>   decline — so a second pricing call is intended, not a retry loop.
>   (`src/checkout-agent.ts`)
>
> And as a **rule** in `spend-cap.md`, because a run that broke it would be
> worth reporting:
> - The agent stops a session once spend reaches $500 rather than continuing.
>   (`src/checkout-agent.ts`)
>
> All of this is what the code intends. I haven't seen any traces, so I can't
> tell you it's what actually happens. Should I record it?

Then stop and wait. Do not write on an implied yes, a "sounds good" about
something else, or your own confidence.

If the user corrects you, revise and show them the revision. Confirmation
covers the content you showed — if the content changes, ask again.

If the user declines, write nothing and say what you did not write. Do not
offer a reduced version unless they ask.

## 3. Write

Only after an explicit yes, and only the content you showed.

**Agent understanding** — `write_learn_agent_artifact_version` with the agent
name and `expected_latest_version` set to the latest version you read, or
`null` if it had none. Build the document to
[agent-artifact-contract.md](agent-artifact-contract.md).

### The source-only profile

The contract is written for a writer that has studied production traces. You
have not. It already allows omitting a section and skipping dimensions the
evidence does not support, so apply it like this and do not invent a section
to fill a gap.

| Contract asks for | From source code |
| --- | --- |
| Agent purpose and the task | Write it. Code states intent well. |
| Shape of a normal trace | **Omit the section entirely.** You have not seen a trace, and inferring a span sequence from control flow is how a document starts asserting things that are not true. |
| Tool catalog — one entry per tool | Write it. This is the highest-value part and it is legible from source. |
| Tool arguments, sequencing, idioms | Write them, marked as intent. |
| Tool latency bands, call counts per run, result sizes | **Leave out.** These are runtime facts. A guess here calibrates the auditor against a number nobody measured. |
| One Mermaid architecture diagram | **Required — you cannot skip it.** The API rejects a first version without one. Draw the architecture the code describes and say so; do not draw a trace you have not seen. |
| Inline confidence qualifiers | Mark every code-derived claim, e.g. `(intended — from source, not observed)`. This is what lets Lemma and the next reader tell intent from observation, and it is why a later learning run can upgrade the claim instead of contradicting it. |

**Tool names have the same binding problem as the agent name.** The contract
says to use the name as it appears in spans, and before instrumentation runs
there are no spans. Use the name the agent will emit — the string registered
with the SDK or the tool schema, not the function or class symbol, when they
differ. Where you cannot tell, say which name you used and what it was derived
from, so a mismatch is visible rather than silent. See
[discover.md](discover.md).

**Project context files** — `upload_project_artifact` with a filename that
says what it holds. Build each file to
[project-context-contract.md](project-context-contract.md): one subject per
file, one rule per line.

**Changing what is already there** — `update_project_artifact` with the
`expected_content_sha256` you read, or `delete_project_artifact` when a rule
is gone entirely. Removing a stale rule is a real edit with real consequences;
confirm it as specifically as you would confirm adding one, and never bundle
it with unrelated changes.

Versions are append-only. Writing an understanding document never overwrites a
previous version — it adds the next one, and the history stays intact.

## Preconditions and conflicts

Both write paths require a token proving you read current state first. If it is
stale you get a `409` and nothing is written — someone else changed the
artifact between your read and your write.

When that happens: re-read, work out what changed, and **show the user the new
situation before writing again**. Their approval was for a world that no
longer exists. Never retry a rejected write with a refreshed token and the same
content without asking.

## Afterwards

Tell the user what landed: which agent, which files, whether the understanding
is a first version or supersedes one. Keep it short. If something failed, say
what failed and what state the project is in now — a partial run is fine, but
a partial run the user thinks was complete is not.
