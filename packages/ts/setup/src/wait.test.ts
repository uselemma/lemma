import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type { InteractiveResult } from "./command.js";
import { EXIT_CODES } from "./errors.js";
import { cursorConfigPath } from "./mcp/paths.js";
import type { PendingSetup } from "./pending.js";
import { WAIT_BUDGET_SECONDS } from "./poll.js";
import { setupPaths } from "./setup-paths.js";
import { shellWord } from "./shell.js";
import {
  approved,
  denied,
  DEVICE_CODE,
  expired,
  pending,
  slowDown,
} from "./testing/mock-api.js";
import {
  approvedWithKey,
  cursorEntry,
  INGEST_KEY,
  printed,
  PRODUCTION_MCP_ENTRY,
  PROJECT_ID,
  rejection,
  runsAsRoot,
  setupRuns,
} from "./testing/setup-run.js";
import { posix } from "./testing/temp.js";
import { runWait } from "./wait.js";

const { setUp, temporaryDirectory } = setupRuns();

describe("wait", () => {
  it("writes .env, .env.example, and the MCP config once approved, reporting each as it lands", async () => {
    const run = await setUp({
      api: { polls: [pending, slowDown, approvedWithKey] },
      gitIgnored: false,
    });
    await run.start();
    run.lines.length = 0;
    await expect(run.wait()).resolves.toEqual({ status: "approved" });

    const env = join(run.app, ".env");
    expect(await readFile(env, "utf8")).toBe(
      `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
    );
    if (posix) expect((await stat(env)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(run.app, ".env.example"), "utf8")).toBe(
      "LEMMA_API_KEY=\nLEMMA_PROJECT_ID=\n",
    );
    expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
    await expect(stat(run.pendingPath)).rejects.toThrow();

    const firstWords = run.lines.slice(1).map((line) => line.split(" ")[0]);
    expect(firstWords.slice(0, 7)).toEqual([
      "Approved.",
      "Project",
      "Agent",
      ".env:",
      "Warning:",
      ".env.example:",
      "MCP:",
    ]);
    const config = cursorConfigPath({ homeDir: run.home, env: {} });
    expect(run.lines.slice(-4)).toEqual([
      `Before you deploy, add LEMMA_API_KEY and LEMMA_PROJECT_ID to your deployment's environment variables or secrets.`,
      `MCP: to sign in to Lemma as yourself, run \`(cd ${shellWord(run.app)} && agent mcp login lemma)\` in a terminal, or sign in to \`lemma\` from Cursor's MCP settings.`,
      "MCP: reload MCP servers in Cursor Settings to load the Lemma tools.",
      "Lemma setup finished.",
    ]);
    expect(run.lines).toContain(
      `MCP: added the \`lemma\` server in ${config}.`,
    );
    // No person at the terminal: the sign-in is printed, never run.
    expect(run.interactiveCalls).toEqual([]);
    for (const secret of [INGEST_KEY, DEVICE_CODE])
      expect(printed(run)).not.toContain(secret);
  });

  it("ignores an MCP key an earlier server still returns, writing the server without it", async () => {
    const mcpKey = "lemma_sk_admin_fedcba9876543210";
    const run = await setUp({
      api: {
        polls: [
          approved({
            project_id: PROJECT_ID,
            agent_name: "support-bot",
            ingest_key: INGEST_KEY,
            mcp_key: mcpKey,
          }),
        ],
      },
    });
    await run.start();
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
    expect(
      await readFile(cursorConfigPath({ homeDir: run.home, env: {} }), "utf8"),
    ).not.toContain(mcpKey);
    expect(printed(run)).not.toContain(mcpKey);
  });

  it("runs the agent's sign-in at a terminal once the spent code is gone, then says how to load the tools", async () => {
    const run = await setUp({
      api: { polls: [approvedWithKey] },
      interactive: true,
    });
    await run.start({ harness: "codex" });
    let pendingAtSignIn: boolean | null = null;
    const runInteractive = run.environment.runInteractive;
    run.environment.runInteractive = async (command, args, cwd) => {
      pendingAtSignIn = await stat(run.pendingPath).then(
        () => true,
        () => false,
      );
      return runInteractive(command, args, cwd);
    };
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(run.interactiveCalls).toEqual([
      { argv: ["codex", "mcp", "login", "lemma"], cwd: run.app },
    ]);
    expect(pendingAtSignIn).toBe(false);
    expect(run.lines.slice(-4)).toEqual([
      `MCP: signing in to Lemma with \`(cd ${shellWord(run.app)} && codex mcp login lemma)\`…`,
      "MCP: signed in to Lemma.",
      "MCP: start a new Codex session to load the Lemma tools.",
      "Lemma setup finished.",
    ]);
  });

  it("runs the agent's sign-in with --sign-in when no person is at the terminal", async () => {
    const run = await setUp({ api: { polls: [approvedWithKey] } });
    await run.start({ harness: "codex" });
    await expect(run.wait({ signIn: true })).resolves.toEqual({
      status: "approved",
    });
    expect(run.interactiveCalls).toEqual([
      { argv: ["codex", "mcp", "login", "lemma"], cwd: run.app },
    ]);
    expect(run.lines).toContain("MCP: signed in to Lemma.");
  });

  it("prints the agent's sign-in without --sign-in when no person is at the terminal", async () => {
    const run = await setUp({ api: { polls: [approvedWithKey] } });
    await run.start({ harness: "codex" });
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(run.interactiveCalls).toEqual([]);
    expect(run.lines).toContain(
      `MCP: to sign in to Lemma as yourself, run \`(cd ${shellWord(run.app)} && codex mcp login lemma)\` in a terminal.`,
    );
  });

  it.each<[string, InteractiveResult, string]>([
    ["exits with 1", { kind: "exited", code: 1 }, "exit code 1"],
    ["cannot start", { kind: "not-started" }, "`codex` could not start"],
    [
      "is interrupted",
      { kind: "signaled", signal: "SIGINT" },
      "it was stopped by SIGINT",
    ],
  ])(
    "prints how to sign in later when the sign-in %s, and still finishes with 0",
    async (_case, signInResult, why) => {
      const run = await setUp({
        api: { polls: [approvedWithKey] },
        interactive: true,
        signInResult,
      });
      await run.start({ harness: "codex" });
      await expect(run.wait()).resolves.toEqual({ status: "approved" });
      expect(run.lines).toContain(
        `MCP: \`codex mcp login lemma\` did not finish (${why}). Later, to sign in to Lemma as yourself, run \`(cd ${shellWord(run.app)} && codex mcp login lemma)\` in a terminal.`,
      );
      expect(run.lines).toContain("Lemma setup finished.");
    },
  );

  it("writes LEMMA_BASE_URL with the new key, and its placeholder, when the API isn't production", async () => {
    const run = await setUp({ api: { polls: [approvedWithKey] } });
    await run.start({ apiUrl: run.api.url });
    await expect(run.wait()).resolves.toEqual({ status: "approved" });

    expect(await readFile(join(run.app, ".env"), "utf8")).toBe(
      `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\nLEMMA_BASE_URL=${run.api.url}\n`,
    );
    expect(await readFile(join(run.app, ".env.example"), "utf8")).toBe(
      "LEMMA_API_KEY=\nLEMMA_PROJECT_ID=\nLEMMA_BASE_URL=\n",
    );
    expect(run.lines).toContain(
      "Before you deploy, add LEMMA_API_KEY, LEMMA_PROJECT_ID, and LEMMA_BASE_URL to your deployment's environment variables or secrets.",
    );
    expect(run.lines).toContain("Lemma setup finished.");
  });

  it("removes a leftover LEMMA_BASE_URL on a production setup", async () => {
    const run = await setUp({
      api: { polls: [approvedWithKey] },
      prepare: async (app) => {
        await writeFile(
          join(app, ".env"),
          "LEMMA_BASE_URL=https://dev.api.uselemma.ai\n",
          { mode: 0o600 },
        );
      },
    });
    await run.start();
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(await readFile(join(run.app, ".env"), "utf8")).toBe(
      `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
    );
    expect(run.lines).toContain(
      ".env: removed LEMMA_BASE_URL, so the app sends traces to production.",
    );
  });

  it("refuses a pending setup whose API setup may not talk to, before any request", async () => {
    const run = await setUp({ api: { polls: [approvedWithKey] } });
    await run.start();
    const saved = JSON.parse(await readFile(run.pendingPath, "utf8"));
    await writeFile(
      run.pendingPath,
      JSON.stringify({ ...saved, apiUrl: "https://uselemma.ai.evil.com" }),
    );
    const requested: string[] = [];
    const error = await rejection(
      runWait(
        { signIn: false },
        {
          ...run.environment,
          fetch: async (input) => {
            requested.push(String(input));
            throw new Error("no request expected");
          },
        },
      ),
    );
    expect(error.message).toContain("is unreadable. Run `start` again.");
    expect(requested).toEqual([]);
    await expect(stat(join(run.app, ".env"))).rejects.toThrow();
  });

  it("returns pending within its budget, keeps the pace, and finishes on a later run", async () => {
    const polls = Array.from({ length: 40 }, () => pending);
    const run = await setUp({ api: { polls: [...polls, approvedWithKey] } });
    await run.start();
    const first = run.api.requests.length;
    await expect(run.wait()).resolves.toEqual({ status: "pending" });
    const polled = run.api.requests.length - first;
    expect(polled).toBe(WAIT_BUDGET_SECONDS / 5);
    expect(printed(run)).toContain(
      "Approval is still pending. Run `npx --yes @uselemma/setup@0.1.0 wait` again.",
    );
    const saved = JSON.parse(
      await readFile(run.pendingPath, "utf8"),
    ) as PendingSetup;
    expect(saved.nextPollAt).toBe(1_000_000 + (polled + 1) * 5_000);

    await expect(run.wait({ signIn: true })).resolves.toEqual({
      status: "pending",
    });
    expect(printed(run)).toContain(
      "Approval is still pending. Run `npx --yes @uselemma/setup@0.1.0 wait --sign-in` again.",
    );
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    await expect(stat(run.pendingPath)).rejects.toThrow();
  });

  it("drops the pending setup when the code is spent: expired, denied, or unknown to the server", async () => {
    for (const polls of [
      [pending, expired],
      [denied],
      [
        {
          status: 404,
          body: {
            detail: "No setup matches this code.",
            code: "setup_authorization_not_found",
          },
        },
      ],
    ]) {
      const run = await setUp({ api: { polls } });
      await run.start();
      const error = await rejection(run.wait());
      expect([EXIT_CODES.expired, EXIT_CODES.denied]).toContain(error.exitCode);
      await expect(stat(run.pendingPath)).rejects.toThrow();
    }
  });

  it.skipIf(!posix || runsAsRoot)(
    "places the key and the MCP server when the spent pending file cannot be deleted, and keeps the run's exit code",
    async () => {
      const run = await setUp({ api: { polls: [approvedWithKey] } });
      await run.start();
      const pendingDirectory = dirname(run.pendingPath);
      await chmod(pendingDirectory, 0o500);
      const result = await run
        .wait()
        .finally(() => chmod(pendingDirectory, 0o700));
      expect(result).toEqual({ status: "approved" });
      expect(await readFile(join(run.app, ".env"), "utf8")).toContain(
        INGEST_KEY,
      );
      expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
      expect(printed(run)).toContain(
        `Warning: setup could not delete ${run.pendingPath} (`,
      );
      expect(printed(run)).toContain("Lemma setup finished.");
      await expect(stat(run.pendingPath)).resolves.toBeDefined();
    },
  );

  it.skipIf(!posix || runsAsRoot)(
    "keeps the server's answer as the error when the spent pending file cannot be deleted",
    async () => {
      const run = await setUp({ api: { polls: [denied] } });
      await run.start();
      const pendingDirectory = dirname(run.pendingPath);
      await chmod(pendingDirectory, 0o500);
      const error = await rejection(
        run.wait().finally(() => chmod(pendingDirectory, 0o700)),
      );
      expect(error.exitCode).toBe(EXIT_CODES.denied);
      expect(printed(run)).toContain(
        `Warning: setup could not delete ${run.pendingPath} (`,
      );
    },
  );

  it("announces a manual add planned only at wait before polling, and finishes with 0", async () => {
    const run = await setUp({ api: { polls: [approvedWithKey] } });
    await run.start();
    expect(printed(run)).not.toContain("After approval, setup prints");
    const config = cursorConfigPath({ homeDir: run.home, env: {} });
    await mkdir(config, { recursive: true });
    run.lines.length = 0;
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    const announced = run.lines.indexOf(
      `MCP: ${config} is not a regular file, so setup does not edit it. After approval, setup prints the \`lemma\` server for you to add to Cursor's MCP servers.`,
    );
    expect(announced).toBeGreaterThanOrEqual(0);
    expect(announced).toBeLessThan(
      run.lines.findIndex((line) => line.startsWith("Waiting for approval")),
    );
    expect(run.lines).toContain(
      JSON.stringify({ mcpServers: { lemma: PRODUCTION_MCP_ENTRY } }, null, 2),
    );
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it("asks for start when no setup is pending in this directory", async () => {
    const run = await setUp({});
    await expect(run.wait()).rejects.toThrow(
      "No setup is waiting for approval in this directory",
    );
    const elsewhere = await setUp({ api: { polls: [approvedWithKey] } });
    await elsewhere.start();
    const other = await temporaryDirectory();
    await expect(
      runWait({ signIn: false }, { ...elsewhere.environment, cwd: other }),
    ).rejects.toThrow("No setup is waiting");
    expect(await readdir(dirname(elsewhere.pendingPath))).toHaveLength(1);
  });

  it("still writes and signs in to the MCP server when Lemma keeps an ingest key this client never reported, then exits 1", async () => {
    const run = await setUp({
      api: {
        polls: [
          approved({ project_id: PROJECT_ID, agent_name: "support-bot" }),
        ],
      },
      interactive: true,
    });
    await run.start();
    const error = await rejection(run.wait());
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    await expect(stat(join(run.app, ".env"))).rejects.toThrow();
    expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
    expect(run.interactiveCalls).toHaveLength(1);
    expect(printed(run)).toContain("returned no ingest key");
    expect(printed(run)).toContain("added the `lemma` server");
    expect(printed(run)).not.toContain("Lemma setup finished.");
  });

  it.skipIf(!posix || runsAsRoot)(
    "saves the ingest key to a private file when .env cannot be written, writes the MCP server, then exits 1",
    async () => {
      const run = await setUp({ api: { polls: [approvedWithKey] } });
      await run.start();
      await chmod(run.app, 0o500);
      const error = await rejection(run.wait());
      await chmod(run.app, 0o700);
      expect(error.exitCode).toBe(EXIT_CODES.failure);
      const saved = setupPaths(run.home, run.app).savedKeys;
      expect(await readFile(saved, "utf8")).toBe(
        `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
      );
      expect((await stat(saved)).mode & 0o777).toBe(0o600);
      expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
      const output = printed(run);
      expect(output).toContain(`Project ID: ${PROJECT_ID}`);
      expect(output).toContain(saved);
      expect(output).not.toContain(INGEST_KEY);
    },
  );

  it.skipIf(!posix)(
    "warns when other users can read an existing .env",
    async () => {
      const run = await setUp({
        api: { polls: [approvedWithKey] },
        prepare: async (app) => {
          await writeFile(join(app, ".env"), "OTHER=1\n", { mode: 0o640 });
        },
      });
      await run.start();
      await run.wait();
      expect(printed(run)).toContain(
        `other users on this machine can read ${join(run.app, ".env")} (mode 640)`,
      );
    },
  );
});
