---
name: lemma-setup
description: >-
  Set up Lemma for an app from the dashboard's setup prompt: infer the project
  and agent names, ask how and what to instrument, approve the connection in
  the browser with `npx @uselemma/setup start` and `wait`, instrument with
  lemma-tracing, connect the Lemma MCP server, and record the first agent
  context. Use when the user pastes Lemma's setup prompt or asks to set up or
  connect Lemma. Do not use to fix traces already in Lemma
  (lemma-diagnostics) or to triage issues (lemma-mcp).
metadata:
  version: 1.0.1
---

# Lemma Setup

You are connecting this app to Lemma, so each run of its agent arrives as a trace, and connecting yourself to the Lemma MCP server. One browser approval by the user creates the Lemma project and two keys: an ingest key for the app and an admin key for your MCP config. `npx @uselemma/setup` writes both. You never see, copy, or ask for a key.

Work through the steps in order. Don't change application code before step 4.

## Rules

- Never print, copy, or ask for a Lemma key, and don't show the contents of `.env`, your MCP config, or the files the setup command writes.
- The setup command is the only writer of `LEMMA_API_KEY`. The `lemma-tracing` rule that you never write a key's value still holds.
- Ask before running the user's agent: a run calls their model provider.
- Keep existing tracing (Langfuse, OpenTelemetry) unless the user asks you to remove it.

## 1. Infer the names

Read the codebase: package manifests, the README, the agent's entry points, and its model and tool calls. Decide these values:

- **Project name**: what the team calls this app, readable by people, for example `Support bot`. Take it from the package or repository name, or the README title
- **Agent name**: the agent's root trace name, in lowercase letters, digits, and dashes, for example `support-bot`. If the code already sends traces to Lemma, reuse that name. With several agents, pick the main production one; the others belong to the scope question. Never `trace`
- **Harness**: your own id from the table below
- **Organization**: the slug in parentheses on the prompt's `Lemma organization:` line, for example `acme-inc-x1y2`. Skip it if the prompt has no such line
- **Framework** (optional): `vercel-ai`, `openai-agents`, `langchain`, `langgraph`, `mastra`, or `direct`
- **Repository** (optional): `owner/repo` from `git remote get-url origin`. Pass only `owner/repo`, never a remote URL, because one can contain credentials

| Coding agent | `--harness` |
| --- | --- |
| Claude Code | `claude-code` |
| Cursor | `cursor` |
| Codex | `codex` |
| OpenCode | `opencode` |
| Pi | `pi` |
| Hermes | `hermes` |
| OpenClaw | `openclaw` |
| Any other coding agent | `other` |

The user confirms or edits both names on the approval page, so don't ask for them here.

Also check `.env` and `.env.example` in the app's root, without reading their contents. Tell the user up front what setup will do differently:

- `.env` is a symlink, or isn't a regular file: setup won't write it, and saves `LEMMA_API_KEY` and `LEMMA_PROJECT_ID` to a private file under `~/.lemma/setup/` instead, for the user to copy where the app loads its environment
- `.env.example` is a symlink, or isn't a regular file: setup leaves it unchanged

## 2. Ask the Approach and Scope questions

Ask two questions before you change code, and wait for both answers. Use your structured question tool if you have one (in Claude Code, `AskUserQuestion`); otherwise ask in chat.

**Approach** (choose one): how the app sends traces. Offer only the paths from `lemma-tracing` that fit this codebase. Say what each one changes, and mark the one you recommend:

- **Framework integration**: `vercelAI()`, the OpenAI Agents processor, the LangChain or LangGraph callback handler, or the Mastra exporter. Fewest code changes; the framework's lifecycle opens and closes each trace
- **Direct SDK**: `lemma.trace(...)` with `recordGeneration` and `recordTool`. Full control where no integration fits, or where one run spans callbacks or processes
- **Alongside existing tracing**: keep Langfuse or OpenTelemetry and add Lemma next to it

**Scope** (choose any): which agent paths to trace first. List the entry points you found, each with one line on what it does and the file it lives in, plus an option for something else. Recommend the main path users reach.

Restate both answers in one or two lines, then continue.

## 3. Approve the connection

Run both commands from the app's root, the directory whose `.env` the app loads. `npx` needs Node.js 20 or later; if it's missing, ask the user to install it, or to follow [manual setup](https://docs.uselemma.ai/tracing/instrumentation/setup#set-up-manually). Both commands need network access, and `start` opens a browser; if your sandbox blocks either, ask the user to allow it.

First, start the approval:

```bash
npx --yes @uselemma/setup@0.1.0 start \
  --harness claude-code \
  --project-name "Support bot" \
  --agent-name support-bot \
  --org acme-inc-x1y2 \
  --framework vercel-ai \
  --repository acme/support-bot
```

`start` returns at once. Show the user the approval URL and code it printed. The user approves on that page:

- They open the URL if no browser opened. If the organization has no plan, the page first asks them to choose one in **Choose your plan**. Checkout returns them to the page. To approve in an organization that already has a plan instead, they choose **Switch organization** below the plans. That button appears only when they belong to another organization
- They check that the page shows the same code and the organization they mean. If the organization is wrong, they choose **Switch organization** next to its name
- If the user says the page names the organization you were set up for and that's the wrong one, the page has no **Switch organization** link. Run `start` again without `--org`, and don't repeat steps 1 and 2. The new page offers **Switch organization** when they belong to another organization
- They confirm the names and choose **Approve and create project** for a new project, or **Approve** for an existing one. Only an owner or admin of the Lemma organization can approve

Then wait for the approval:

```bash
npx --yes @uselemma/setup@0.1.0 wait
```

Each `wait` checks for up to 90 seconds, so it finishes within a default command timeout. While it exits with 5, the approval is still pending: run `wait` again. The code expires 10 minutes after `start`.

When `wait` exits with 0, read `Project ID:` and `Agent name:` from its output. Use that agent name from here on: the user may have changed it on the approval page.

| Exit code | Meaning | Next step |
| --- | --- | --- |
| 0 | Approved; each key is written, kept, or saved to a private file that `start`, or `wait` before it polled, announced | If the output names a private file under `~/.lemma/setup/`, give the user its path and what to copy from it; don't read it yourself. Continue to step 4 |
| 5 | Approval is still pending | Run `wait` again |
| 2 | A flag is wrong | Fix the flag the message names, then run `start` again |
| 3 | The code expired | Run `start` again, and ask the user to approve within 10 minutes |
| 4 | Approval was denied or canceled | Ask the user; an owner or admin must approve. Then run `start` again |
| 1 | Anything else | Show the message. If it says coding-agent setup isn't available on this Lemma environment, point the user to [manual setup](https://docs.uselemma.ai/tracing/instrumentation/setup#set-up-manually). If a write failed after approval, the message says where the key went. When it names a private file under `~/.lemma/setup/`, give the user that path and what to copy from it, and don't read the file yourself. When it says setup could not save the key elsewhere, the key is lost: tell the user to run `start` again, and to revoke the unused `Setup: …` key under **Developer → API keys** in your organization settings |

On success the command has written these:

- `.env`: `LEMMA_API_KEY`, an ingest key that can only send traces to this project, and `LEMMA_PROJECT_ID`. A key already in `.env` that Lemma confirms for the approved project is kept. When `.env` is a symlink or isn't a regular file, both values go to a private file under `~/.lemma/setup/` instead
- `.env.example`: empty `LEMMA_API_KEY=` and `LEMMA_PROJECT_ID=` placeholders, unless it is a symlink or isn't a regular file
- Your MCP config, as a `lemma` server: through `claude mcp add-json` for Claude Code, and in the agent's own config file for Cursor, Codex, OpenCode, Pi, Hermes, and OpenClaw. An admin key already there that Lemma confirms for the organization is kept
- For `other`, or a config it can't edit safely, a file under `~/.lemma/setup/` that only the user can read. The output prints the entry's shape and where to add it; ask the user to add it there, and don't read the file yourself. For Claude Code, the output prints one command that reads the key from the file, replaces any `lemma` server in the project's local scope with `claude mcp add-json`, and deletes the file once that succeeds; you may run it as printed, without reading the file, once the `claude` command is installed. It changes nothing once the file is gone, so a retry is safe. Never add the entry to the project's `.mcp.json`, which is committed

If the output warns that git doesn't ignore `.env`, add `.env` to `.gitignore`.

## 4. Instrument with lemma-tracing

Follow the `lemma-tracing` skill with the Approach and Scope answers. If it isn't installed, fetch `https://raw.githubusercontent.com/uselemma/lemma/main/skills/lemma-tracing/SKILL.md`. These rules apply on top of it:

- The root trace `name` is the agent name from step 3, exactly
- `LEMMA_API_KEY` and `LEMMA_PROJECT_ID` are already in `.env`. Don't ask for a key; its "Handing Back" section covers this case
- The process that runs the agent must load `.env`. Next.js loads it; a Node.js script needs `node --env-file=.env` or `dotenv`; Python needs `python-dotenv` or the framework's loader

## 5. Send the first trace

Ask the user before you run their agent. With `LEMMA_DEBUG=1` set, run it once through a path in scope (a test, a script, or a local request), and confirm the debug log shows `trace sent`. In a new organization, Lemma's setup modal then checks that first trace.

If the user would rather not run it now, tell them the first trace appears under **Traces** in Lemma once the agent runs. In a new organization, Lemma's setup modal waits for that trace before it opens the dashboard.

## 6. Connect the MCP server and record the agent's context

Your harness loads the Lemma MCP server when it reloads its MCP config; the setup output names how (for example `/mcp` in Claude Code, `/reload-mcp` in Hermes, a new Codex session). Ask the user to do it.

Once the Lemma tools are available, follow the `lemma-artifacts` skill for the project ID and agent name from step 3. If it isn't installed, fetch `https://raw.githubusercontent.com/uselemma/lemma/main/skills/lemma-artifacts/SKILL.md`. It records what the agent is for, and it asks the user to approve each claim before writing. If the tools don't load in this session, say how to load them and offer to run `lemma-artifacts` next time.

## 7. Hand back

End with a short report:

- The project and agent names, and every file you changed
- That the key in `.env` can only send traces to this project
- The build and deploy steps that need attention, for example:
  - Add `LEMMA_API_KEY` and `LEMMA_PROJECT_ID` to the deployment's environment variables or secrets (Vercel, Railway, Fly.io, Docker, CI)
  - Set `LEMMA_RELEASE` to the deployed version, such as the commit SHA, during deployment
  - Serverless functions and other short-lived processes must end and send each trace before they exit; `lemma-tracing` covers how
  - A container image or build that doesn't copy `.env` needs the variables set another way
- Any path in scope you didn't instrument, and why
