# Read, propose, confirm, upload

## 1. Read what Lemma already has

Always, before proposing anything. Every call below takes the `project_id`
settled in [SKILL.md](../SKILL.md#the-project-id):

- `list_project_artifacts` with `project_id` and `agent_name` (the settled
  agent name) — the context files uploaded for that agent, and its
  understanding if Lemma has written one. `agent_name` is required. Call it a
  second time with `agent_name: null` for the files of the untagged agent.
  Keep each file's `id`: it is the `artifact_id` every later call needs.
- `get_project_artifact` with `project_id`, an `artifact_id` from that list,
  and `version`, to read the text. Pass `version: null` for an uploaded file
  and `version: "latest"` for the understanding. It returns one window of the text at a time. While
  `next_request` is not null, call the tool again with the arguments it gives
  you. Never judge a file from its first window.
- `get_agent_understanding_history` with `project_id` and `agent_name`, when
  you need to know whether Lemma has written an understanding yet and how many
  versions exist.

No call lists every agent a project has. An agent that has files in Lemma but
no traces cannot be found by browsing, only by asking for its name.

Never skip this because you expect the project to be empty. Empty is a normal
answer, and you have to have read it to know.

What is already there changes what you propose. Do not restate something
Lemma already records, and do not silently contradict it — if the code
disagrees with a recorded claim, that disagreement is the interesting part and
the user should hear it.

## 2. Propose, in specifics

Show the user what you intend to record, before any upload or delete. The confirmation
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
> I'd record these as **context files**, because no trace would show them:
> - `spend-cap.md`: the agent stops a session once spend reaches $500 rather
>   than continuing. (`src/checkout-agent.ts`)
> - `expected-declines.md`: a declined card is an expected outcome, not a
>   failure, and the second `price_cart` call after a decline is intended,
>   not a retry loop. (`src/checkout-agent.ts`)
>
> I'm not recording what the agent does or which tools it calls. Lemma works
> that out itself from traces, and reads these files when it does.
>
> All of this comes from the code; I haven't seen any traces. Should I
> record it?

Then stop and wait. Do not upload on an implied yes, a "sounds good" about
something else, or your own confidence.

If the user corrects you, revise and show them the revision. Confirmation
covers the content you showed — if the content changes, ask again.

If the user declines, upload nothing. Do not offer a reduced version unless
they ask. Go straight to the [closing report](#closing-report), which is
where you say what was not uploaded: a decline ends the upload, not the run.

## 3. Upload

Only after an explicit yes, and only the content you showed.

**A new file** — `upload_project_artifact` with `project_id`, `agent_name`,
`filename` and `content`. Give it a filename that says what it holds. Build
each file to [project-context-contract.md](project-context-contract.md): one
subject per file, one statement per line. Expect several: rules, intended
behaviour that looks like a failure, and setup facts each get their own file.

Every upload creates a new file, including when one with the same filename
already exists. Check the list from step 1 first, so you replace a file you
meant to replace instead of adding a second copy beside it.

**Replacing a file** — there is no edit in place. Upload the new text with
`upload_project_artifact` as above, confirm the new file appears in
`list_project_artifacts`, then remove the old one with
`delete_project_artifact`, passing `project_id` and the old file's
`artifact_id` from step 1, never the `id` the upload just returned. Do it in
that order: if the second call fails, the
project has a duplicate, which is recoverable, and not a gap. The replacement
has a new `id`. Tell the user both of those things when you ask to replace.

This is what the contract's "Changing one" section means by updating a file.
That file is copied verbatim from Lemma and is never edited to fit this skill,
so where it says update, read replace. It also says not to leave a corrected
rule sitting beside the original, which is why the delete follows as soon as
the new file is confirmed, and why a delete that fails goes in the closing
report.

**Removing a file** — `delete_project_artifact` with `project_id` and the
file's `artifact_id` from step 1, when a rule is gone entirely.
Removing a stale rule is a real edit with real consequences; confirm it as
specifically as you would confirm adding one, and never bundle it with
unrelated changes.

Replace or delete only a file this run uploaded, or one the user named. See
core rule 7 in [SKILL.md](../SKILL.md).

## If the file changed while you were working

Lemma does not lock a file between your read and your replace or delete, and it will not
reject a delete because someone else changed the file first. The check is
yours to make.

Before you replace or delete a file, read it again in full and compare it
with the text you showed the user, along with its `updated_at` and
`byte_length` in the list. If anything differs, **show the user the new
situation before you replace or delete**. Their approval was for a file that no longer
exists in that form. Never carry an approval across a change.

## Closing report

Every run ends here, whichever way step 2 and step 3 went:

- **Uploaded.** Say which agent and which files, and which files you replaced
  or removed. Say once that Lemma writes the understanding itself, from traces
  and from these files, so none appears until the agent's first traces have
  been processed.
- **Declined.** Say that nothing was uploaded and what the proposal was, so
  the user can come back to it.
- **Failed part-way.** Say what failed and what state the project is in now.
  A partial run is fine; a partial run the user thinks was complete is not.

Keep it short. Then, once and only once, continue to
[tracing-handoff.md](tracing-handoff.md). It decides for itself whether to
offer; do not decide that here.
