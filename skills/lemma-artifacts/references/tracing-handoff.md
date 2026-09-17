# Offer to set up tracing

Recording is read-only. Instrumentation is not, and it is the other half of
what a customer arriving from Lemma's onboarding wants. This is the one place
this skill raises tracing on its own. The offer is a question; the work
belongs to `lemma-tracing`, and you never install the SDK or edit code under
this skill.

The decision to offer is made here and only here. What
[discover.md](discover.md) decides is earlier and different: whether the run
proceeds to record at all. A run that stopped there never reaches this file.
[record.md](record.md) links here from its closing report and does not
restate any of this.

## When to offer

Run this once, right after the closing report in
[record.md](record.md) — whether that report says what landed, or that the
user declined the proposed write and nothing was written. All of the
following must hold:

- **One settled production target for this run, under a fixed name.** The
  repository may hold several agents; what matters is that discovery settled
  on one of them — chosen by the user when there were candidates — and that
  its name is fixed (see "The agent's name" in [discover.md](discover.md)).
  No production agent, or a name the user never settled, means there is
  nothing to offer for: stop.
- **That agent is not instrumented.** None of the Lemma SDK signals from
  [discover.md](discover.md) — `@uselemma/tracing`, `uselemma_tracing`,
  `withAgent`, `lemma.trace` — appear on its production path. If any do,
  say nothing more about tracing.
- **You have not offered already in this conversation.** Once.

A declined artifact write does not by itself withdraw the offer: the agent is
still identified and still uninstrumented, and the customer may want traces
even if they did not want the description.

## How to offer

As its own question, never folded into the artifact approval. Name the
skill, name the agent, and say plainly that, unlike everything you have done
so far, this step edits their code. In the spirit of, after a write:

> Recorded. `checkout-agent` isn't sending traces to Lemma yet — there is no
> Lemma SDK on its path. Want me to set that up now with the `lemma-tracing`
> skill, under the name `checkout-agent`? Unlike the recording, that step
> edits your code, and I'll show you a plan before touching anything.

And after a decline:

> Understood — nothing was written. Separately: `checkout-agent` isn't
> sending traces to Lemma yet. Want me to set that up with the
> `lemma-tracing` skill, under the name `checkout-agent`? That step edits
> your code, and I'll show you a plan first.

## Afterwards

On an explicit yes, read and follow `lemma-tracing` and carry the agent name
over verbatim as the root trace `name`. On anything else, stop; do not ask
twice.
