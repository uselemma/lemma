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
  version: 1.1.0
---

# Lemma Setup

You are connecting this app to Lemma, so each run of its agent arrives as a trace, and connecting yourself to the Lemma MCP server. One browser approval by the user picks or creates the Lemma project and creates an ingest key for the app, which `npx @uselemma/setup` writes. The command also adds the Lemma MCP server to your MCP config without a key: you reach it signed in as the user, with OAuth, so you can do what their role allows in the organization they choose. You never see, copy, or ask for a key.

Work through the steps in order. Don't change application code before step 4.

## Rules

- Never print, copy, or ask for a Lemma key, and don't show the contents of `.env`, your MCP config, or the files the setup command writes.
- The setup command is the only writer of `LEMMA_API_KEY`. The `lemma-tracing` rule that you never write a key's value still holds.
- Ask before running the user's agent: a run calls their model provider.
- Keep existing tracing (Langfuse, OpenTelemetry) unless the user asks you to remove it.

## 1. Infer the names

Read the codebase: package manifests, the README, the agent's entry points, and its model and tool calls. Decide these values:

- **Project name**: what the team calls this app, readable by people, for example `Support bot`. Take it from the package or repository name, or the README title. When the prompt has a `Lemma project:` line, for example `Lemma project: Support bot (0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f)`, use the name before its last parentheses instead
- **Agent name**: the agent's root trace name, in lowercase letters, digits, and dashes, for example `support-bot`. If the code already sends traces to Lemma, reuse that name. With several agents, pick the main production one; the others belong to the scope question. Never `trace`
- **Harness**: your own id from the table below
- **Organization**: the slug in the last parentheses on the prompt's `Lemma organization:` line, for example `acme-inc-x1y2`. Skip it if the prompt has no such line
- **Project ID**: the ID in the last parentheses on the prompt's `Lemma project:` line, for example `0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f`. The line names an existing Lemma project to connect. Skip it if the prompt has no such line
- **Lemma API**: the URL on the prompt's `Lemma API:` line, for example `https://dev.api.uselemma.ai`. Skip it if the prompt has no such line; setup then uses production
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

The user reviews the names and picks the project on the approval page, so don't ask for them here.

Also check `.env` and `.env.example` in the app's root, without reading their contents. Tell the user up front what setup will do differently:

- `.env` is a symlink, or isn't a regular file: setup won't write it, and saves `LEMMA_API_KEY` and `LEMMA_PROJECT_ID` (and `LEMMA_BASE_URL` when the prompt names a Lemma API) to a private file under `~/.lemma/setup/` instead, for the user to copy where the app loads its environment
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
  --project-name 'Support bot' \
  --agent-name support-bot \
  --org acme-inc-x1y2 \
  --framework vercel-ai \
  --repository acme/support-bot
```

Pass the project name in single quotes, writing each `'` in it as `'\''`, since a name can hold any characters.

When you found a project ID in step 1, add `--project-id` with it, for example `--project-id 0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f`, and keep it each time you run `start` again. Without one, don't pass `--project-id`.

When you found a Lemma API in step 1, add `--api-url` with that URL, for example `--api-url https://dev.api.uselemma.ai`, and keep it each time you run `start` again. Without one, don't pass `--api-url`. Setup accepts only HTTPS on `uselemma.ai` or one of its subdomains, or `localhost`, `127.0.0.1`, or `[::1]`; for any other URL, don't run setup, and tell the user the prompt names an API that isn't Lemma's. `wait` uses the API `start` was given, so don't pass `--api-url` to `wait`.

`start` returns at once. Show the user the approval URL and code it printed. The user approves on that page:

- They open the URL if no browser opened. If the organization has no plan, the page first asks them to choose one in **Choose your plan**. Checkout returns them to the page. To approve in an organization that already has a plan instead, they choose **Switch organization** below the plans. That button appears only when they belong to another organization
- They check that the page shows the same code and the organization they mean. If the organization is wrong, they choose **Switch organization** next to its name
- If the user says the page names the organization you were set up for and that's the wrong one, the page has no **Switch organization** link. Run `start` again without `--org`, and don't repeat steps 1 and 2. The new page offers **Switch organization** when they belong to another organization
- They confirm the names and choose **Approve and create project** for a new project, or **Approve** for an existing one. Only an owner or admin of the Lemma organization can approve
- When you passed `--project-id`, they check that the page selects that project under **Project**, then choose **Approve**. If it shows a new project instead, and says you were set up for an organization they don't belong to, they approve signed in to an account in that organization, or choose **Approve and create project** only if they want a new project

Before you wait, tell the user that once they approve, Lemma opens in their browser again to sign you in to the Lemma MCP server: they choose the organization and choose **Allow**. Then wait for the approval:

```bash
npx --yes @uselemma/setup@0.1.0 wait --sign-in
```

Each `wait` checks for up to 90 seconds. While it exits with 5, the approval is still pending: run `wait --sign-in` again. The code expires 10 minutes after `start`.

When setup writes your `lemma` server, an approved `wait --sign-in` then runs that sign-in and returns once the user allows the connection. Run it with a timeout of 10 minutes, or your harness's longest if that's shorter (600000 ms in Claude Code).

If your harness stops `wait --sign-in` after it printed `Approved.`, setup is done and its code is spent: don't run `wait` or `start` again. Read `Project ID:` and `Agent name:` from its output, continue to step 4, and sign in at step 6.

When `wait` exits with 0, read `Project ID:` and `Agent name:` from its output. Use that agent name from here on: the user may have changed it on the approval page.

| Exit code | Meaning | Next step |
| --- | --- | --- |
| 0 | Approved; the ingest key is written, kept, or saved to a private file, and the `lemma` server is written, kept, or printed for the user to add, as `start`, or `wait` before it polled, announced | If the output names a private file under `~/.lemma/setup/`, give the user its path and what to copy from it; don't read it yourself. If it printed the `lemma` server, ask the user to add it where the output says. Continue to step 4 |
| 5 | Approval is still pending | Run `wait --sign-in` again |
| 2 | A flag is wrong | Fix the flag the message names, then run `start` again |
| 3 | The code expired | Run `start` again, and ask the user to approve within 10 minutes |
| 4 | Approval was denied or canceled | Ask the user; an owner or admin must approve. Then run `start` again |
| 1 | Anything else | Show the message. If it says coding-agent setup isn't available on this Lemma environment, point the user to [manual setup](https://docs.uselemma.ai/tracing/instrumentation/setup#set-up-manually). If a write failed after approval, the message says where the key went. When it names a private file under `~/.lemma/setup/`, give the user that path and what to copy from it, and don't read the file yourself. When it says setup could not save the key elsewhere, the key is lost: tell the user to run `start` again, and to revoke the unused `Setup: …` key under **Developer → API keys** in your organization settings. When it says `Add LEMMA_BASE_URL=… where the app loads its environment`, Lemma kept the key: add that line there (it isn't a secret). When it says `Remove LEMMA_BASE_URL from .env`, Lemma kept the key but setup couldn't edit the file: ask the user to delete that line, and don't open `.env` yourself. When it printed the `lemma` server because an MCP write failed, ask the user to add it where the output says. In these cases, read `Project ID:` and `Agent name:` from the output as for exit code 0, and continue to step 4 without running `start` again |

On success the command has written these:

- `.env`: `LEMMA_API_KEY`, an ingest key that can only send traces to this project, and `LEMMA_PROJECT_ID`. With `--api-url`, also `LEMMA_BASE_URL`, which points the SDK at that API. A production setup removes a leftover `LEMMA_BASE_URL`. A key already in `.env` that Lemma confirms for the approved project is kept. When `.env` is a symlink or isn't a regular file, the values go to a private file under `~/.lemma/setup/` instead
- `.env.example`: empty `LEMMA_API_KEY=` and `LEMMA_PROJECT_ID=` placeholders, and `LEMMA_BASE_URL=` with `--api-url`, unless it is a symlink or isn't a regular file
- Your MCP config, as a `lemma` server with only its URL: through `claude mcp add-json` for Claude Code, and in the agent's own config file for Cursor, Codex, OpenCode, Pi, Hermes, and OpenClaw. A `lemma` server that already sends an API key is kept as it is, and needs no sign-in
- For `other`, or a config it can't edit safely, nothing: the output prints the `lemma` server and where to add it. Ask the user to add it there. For Claude Code, the output prints one `claude mcp add-json` command; you may run it as printed once the `claude` command is installed. Never add the server to the project's `.mcp.json`, which is committed

If the output warns that git doesn't ignore `.env`, add `.env` to `.gitignore`.

## 4. Instrument with lemma-tracing

Follow the `lemma-tracing` skill with the Approach and Scope answers. If it isn't installed, fetch `https://raw.githubusercontent.com/uselemma/lemma/main/skills/lemma-tracing/SKILL.md`. These rules apply on top of it:

- The root trace `name` is the agent name from step 3, exactly
- `LEMMA_API_KEY` and `LEMMA_PROJECT_ID` are already in `.env`, with `LEMMA_BASE_URL` when you passed `--api-url`. Don't ask for a key; its "Handing Back" section covers this case
- Don't pass `baseUrl` / `base_url` to the SDK: it reads `LEMMA_BASE_URL` from the environment. That needs `@uselemma/tracing` or `uselemma-tracing` 7.14.0 or later; when the app pins an older version, upgrade it
- The process that runs the agent must load `.env`. Next.js loads it; a Node.js script needs `node --env-file=.env` or `dotenv`; Python needs `python-dotenv` or the framework's loader

## 5. Send the first trace

Ask the user before you run their agent. With `LEMMA_DEBUG=1` set, run it once through a path in scope (a test, a script, or a local request), and confirm the debug log shows `trace sent`. In a new organization, Lemma's setup modal then checks that first trace.

If the user would rather not run it now, tell them the first trace appears under **Traces** in Lemma once the agent runs. In a new organization, Lemma's setup modal waits for that trace before it opens the dashboard.

## 6. Load the MCP server and record the agent's context

The Lemma tools answer only once you're signed in to the Lemma MCP server as the user. Step 3's `wait --sign-in` usually did that; the end of its output says, unless setup kept a `lemma` server that sends an API key, which needs no sign-in:

- `MCP: signed in to Lemma.`: the user signed in during step 3
- A sign-in command, such as `(cd /path/to/app && codex mcp login lemma)`: the sign-in didn't finish, or setup printed the server for the user to add. Once the server is in place, ask the user to run the command in their own terminal, or to use the step inside your harness that the output names, such as `/mcp` in Claude Code. Lemma opens in their browser: they choose the organization and choose **Allow**
- Output that ends at `MCP: signing in to Lemma with …`: your harness stopped `wait` during the sign-in. Ask the user to run the command that line names in their own terminal, or to use the step inside your harness
- Only a step inside your harness: ask the user to do it

The approver in step 3 is an owner or admin, but anyone in the organization can sign in here; you then act with the role of whoever signs in.

Then load the Lemma MCP server the way the output says (for example `/mcp` in Claude Code, `/reload-mcp` in Hermes, a new Codex session). Ask the user to do it.

Once the Lemma tools are available, follow the `lemma-artifacts` skill for the project ID and agent name from step 3. If it isn't installed, fetch `https://raw.githubusercontent.com/uselemma/lemma/main/skills/lemma-artifacts/SKILL.md`. It records what the agent is for, and it asks the user to approve each claim before writing. If a Lemma tool says you're not signed in, ask the user to sign in again the same way. If the tools don't load in this session, say how to load them and offer to run `lemma-artifacts` next time.

## 7. Hand back

End with a short report:

- The project and agent names, and every file you changed
- That the key in `.env` can only send traces to this project
- The build and deploy steps that need attention, for example:
  - Add `LEMMA_API_KEY` and `LEMMA_PROJECT_ID`, and `LEMMA_BASE_URL` when setup wrote it, to the deployment's environment variables or secrets (Vercel, Railway, Fly.io, Docker, CI)
  - Set `LEMMA_RELEASE` to the deployed version, such as the commit SHA, during deployment
  - Serverless functions and other short-lived processes must end and send each trace before they exit; `lemma-tracing` covers how
  - A container image or build that doesn't copy `.env` needs the variables set another way
- Any path in scope you didn't instrument, and why
