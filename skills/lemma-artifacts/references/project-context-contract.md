A project text artifact is the customer's own account of their system: the rules their agent is required to obey and the facts about their setup that no trace reveals. It is not a description of how the agent behaves — that belongs in the agent knowledge document, which is rebuilt from observed runs. This one is not rebuilt from anything. It stands until someone changes it deliberately.

That difference decides what goes here. Ask whether a run that disagreed with the statement would be a problem worth reporting:

- **Yes — it belongs here.** "Refunds above $500 require a human approver." "The agent must never quote a delivery date it did not get from the shipping tool." "Escalation to a human is mandatory once a customer uses the word 'lawyer'." A trace that departs from one of these is a finding, not an update.
- **No — it belongs in the knowledge document.** "Retrieval usually runs twice per turn." "The summarizer is slow on long threads." These describe what happens, and what happens is what traces are for.

Facts that no trace can carry belong here too, whether or not a run could violate them: which environments send traces, which agent names map to which surface, what an internal code or enum means, which failures are expected and routine in this domain.

## Writing one

- **One subject per file.** A file about the refund policy and a file about escalation rules are two files. They are read independently, and a reader given one should not have to know the other exists.
- **Give it a filename that says what it holds** — `refund-policy.md`, `escalation-rules.md`. The filename is shown wherever the content is used, and it is often the only label a reader gets.
- **State rules in the form of a rule.** "Refunds above $500 require a human approver" is checkable. "We are careful about large refunds" is not.
- **One statement per line or bullet.** A paragraph mixing four rules cannot be cited, corrected, or removed independently.
- **Say what you know and stop.** An empty file is better than a padded one; anything inferred rather than established is a liability here, because nothing downstream re-checks it.
- **Attribute nothing to the future.** Planned behavior, deprecated behavior, and aspirational documentation do not belong. If a rule is not in force now, leave it out.
- **Never include secrets, credentials, API keys, tokens, connection strings, or personal data about real customers.** This content is stored and read by models. Source code itself does not belong here either — describe the rule, not the implementation.

Markdown or plain text, up to 256 KB per file. Prefer several small files to one large one.

## Changing one

These artifacts persist, so a stale one is worse than a missing one — it keeps asserting a rule the system no longer has. When the underlying rule changes, update the file; when the rule is gone, remove the file. Do not leave a corrected rule sitting alongside the original, and do not record the change as history inside the file. The file always states what is true now.
