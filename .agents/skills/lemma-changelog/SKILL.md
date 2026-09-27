---
name: lemma-changelog
description: >-
  Write or update Lemma changelog entries. Use when adding a changelog update,
  editing the platform, TypeScript SDK, Python SDK, or docs changelog, or when
  asked to record a release, deploy, or docs change in the changelog.
metadata:
  version: "1.0.0"
---

# Lemma changelog

Write user-facing changelog entries in the Mintlify docs. This skill is a Lemma-owned agent skill at `.agents/skills/lemma-changelog/`. It is not a product skill. Do not copy it into `skills/`.

Also follow [lemma-writing-guidelines](../lemma-writing-guidelines/SKILL.md) for prose. The entry shape below overrides the handbook where they disagree: no intro paragraph, and bullets use `- **Label:** explanation`.

## Pages

One change can belong on more than one page. Write each entry for that page’s reader.

| Change | Page | Group by |
| --- | --- | --- |
| Dashboard, API, Slack, billing, settings, or other product behavior that reached production | `docs/changelog.mdx` | Day |
| Published `@uselemma/tracing` behavior | `docs/changelog/typescript.mdx` | Version |
| Published `uselemma-tracing` behavior | `docs/changelog/python.mdx` | Version |
| A documentation change a reader can use | `docs/changelog/docs.mdx` | Day |

Do not add a fifth changelog page unless asked. The Changelog tab and Changelog group in `docs/docs.json` already list these four. Page titles stay Platform, TypeScript SDK, Python SDK, and Docs.

Leave published package versions unchanged. A changelog edit does not ship an SDK.

## Before writing

1. Read the target page and match its frontmatter, tags, and bullet shape.
2. If that day or version already has an `<Update>`, add to it. Mintlify requires a unique `label`, so a second Update with the same label is invalid.
3. Put new days and new versions first. The newest entry is the first `<Update>` after the frontmatter.
4. Do not backfill platform days before August 18, 2026, SDK versions before 7.1.0, or docs days before June 30, 2026.

## What to include

Write the behavior a person can use. Name the outcome, then the constraint that changes what they do.

Include:

- Product behavior that is live for customers.
- A feature whose flag defaults on. Describe it as shipped. Do not say it is behind a flag.
- A feature whose flag was removed, dated to the day customers get it.
- An SDK change that is inside the published version you are labeling.
- A docs change that adds, moves, or corrects something a reader can follow.

Leave out:

- SDK changes on the platform page. Those go on the SDK pages.
- Dashboard-only behavior on an SDK page.
- Harness plugin releases (`@uselemma/opencode`, `@uselemma/pi`, `@uselemma/hermes`, `@uselemma/openclaw`) unless the tracing package’s public API changed.
- Features whose production flag still defaults off.
- Staff-only tools, internal deploys, and model swaps.
- CI-only, test-only, lockfile-only, and version-bump-only commits.
- Docs edits that do not change what a reader can do: theme, favicon, icons, and files that are not in the published nav.
- Internal ticket ids and flag names.

TypeScript and Python version numbers diverge. Label each page with that package’s published version. A shared behavior can be 7.12.4 in TypeScript and 7.12.2 in Python.

The production flag value is the Flagship default variation in `uselemma/platform` `docs/flagship.md` at that deploy. A code `defaultValue: false` is the outage fallback, not the live default.

## Shape

Platform and docs, one day:

```mdx
<Update label="September 27, 2026" tags={["Bug fixes", "[Traces]"]} rss={{ title: "Trace pages fill with processed traces" }}>

  ## Traces

  - **Processed traces:** With **Show unprocessed** off, each [traces](/platform/traces) page fills with processed traces, so you don’t get a page of empty slots.

</Update>
```

SDK, one version. `description` is the release date and nothing else:

```mdx
<Update label="7.12.4" description="September 17, 2026" tags={["Bug fixes", "[LangChain]"]} rss={{ title: "Root output flattens reasoning blocks" }}>

  ## LangChain

  - **Root output:** Reasoning content blocks become the answer string on the root trace output.

</Update>
```

Rules for that shape:

- Platform and docs labels are `Month D, YYYY`. They do not use `description`.
- SDK labels are the version only, such as `7.12.4`, with no `v` prefix.
- `rss.title` is a headline. It is not the date or the version.
- Kind tags are exactly `New releases`, `Improvements`, and `Bug fixes`, without brackets. Put them first.
- Domain tags are wrapped in brackets: `[Issues]`, `[Tracing]`. Put them after the kind tags.
- The `##` heading is the domain name without brackets.
- Bullets are `- **Label:** explanation`. The colon sits inside the bold label. Link the docs page that explains the behavior when one exists.
- Use curly quotes in prose. Use straight quotes in JSX attributes and code.
- Do not use em dashes. Do not use easy, simple, quick, just, very, or really.
- Do not add an intro paragraph under the frontmatter. Do not start a page description with “Stay up to date with”.
- Do not set `noindex`.

Mintlify treats selected tags as AND. An update must include every tag that should find it. One day or version stays one Update, even when it has several sections. Selecting `[Issues]` shows that whole day, including the other sections on it.

## Domains

Reuse a domain already on that page. Add a new bracketed domain only when readers will filter for that area again and it is not a subset of an existing tag.

Do not invent a domain for a feature that already has a home:

- Trial and subscription access is `[Billing]`, not `[Access]`.
- A host and sandbox recorded as one turn is `[Tracing]`, not `[Cross-process turns]`.

`[Support access]` stays. It is the owner control for Lemma support, which is its own product surface.

## After editing

Read the Update you touched and check:

- The label is unique on that page.
- Kind tags are unbracketed and domain tags are bracketed.
- The heading matches a domain tag on that Update.
- The bullet says what the reader can do, not which commit or flag produced it.
- A default-off feature is absent.
- The same behavior is not copied onto the wrong page.
