import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "./errors.js";
import type { PendingSetup } from "./pending.js";
import { setupPaths } from "./setup-paths.js";
import { shellWord } from "./shell.js";
import { DEVICE_CODE, USER_CODE } from "./testing/mock-api.js";
import {
  approvedWithKey,
  cursorEntry,
  INGEST_KEY,
  printed,
  PROJECT_ID,
  rejection,
  runsAsRoot,
  setupRuns,
} from "./testing/setup-run.js";
import { posix } from "./testing/temp.js";

const { setUp } = setupRuns();

describe("start", () => {
  it("starts the handshake, saves it for wait, and returns without polling", async () => {
    const run = await setUp({});
    await run.start({
      repository: "acme/support-bot",
      framework: "vercel-ai",
      org: "acme-inc-x1y2",
      projectId: "0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f",
    });
    expect(run.api.startBody()).toEqual({
      harness: "cursor",
      inferred: {
        project_name: "Support bot",
        agent_name: "support-bot",
        repository: "acme/support-bot",
        framework: "vercel-ai",
      },
      org_slug: "acme-inc-x1y2",
      project_id: "0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f",
    });
    expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
    expect(run.opened).toEqual([
      `${run.api.url}/connect/setup?user_code=${USER_CODE}`,
    ]);
    const saved = JSON.parse(
      await readFile(run.pendingPath, "utf8"),
    ) as PendingSetup;
    expect(saved).toMatchObject({
      version: 1,
      appDir: run.app,
      harness: "cursor",
      deviceCode: DEVICE_CODE,
      userCode: USER_CODE,
      expiresAt: 1_600_000,
      interval: 5,
      nextPollAt: 1_005_000,
      existingIngestProjectId: null,
    });
    if (posix) expect((await stat(run.pendingPath)).mode & 0o777).toBe(0o600);
    expect(printed(run)).toContain("npx --yes @uselemma/setup@0.1.0 wait");
    expect(printed(run)).not.toContain(DEVICE_CODE);
  });

  it.skipIf(!posix)(
    "plans a symlinked .env as a private file, says so before approval, and finishes with 0",
    async () => {
      const run = await setUp({
        api: { polls: [approvedWithKey] },
        prepare: async (app) => {
          await writeFile(join(app, "real.env"), "UNTOUCHED=1\n");
          await symlink(join(app, "real.env"), join(app, ".env"));
        },
      });
      await run.start();
      const saved = setupPaths(run.home, run.app).savedKeys;
      expect(printed(run)).toContain(
        `.env: ${join(run.app, ".env")} is a symlink, so setup does not write it. After approval, setup saves LEMMA_API_KEY and LEMMA_PROJECT_ID to ${saved} (readable only by you) instead.`,
      );
      await expect(run.wait()).resolves.toEqual({ status: "approved" });
      expect(await readFile(join(run.app, "real.env"), "utf8")).toBe(
        "UNTOUCHED=1\n",
      );
      expect(await readFile(saved, "utf8")).toBe(
        `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
      );
      expect(printed(run)).toContain("Lemma setup finished.");
      expect(printed(run)).not.toContain(INGEST_KEY);
    },
  );

  it("skips an .env.example that is not a file, saying so at start and wait, and never fails for it", async () => {
    const run = await setUp({
      api: { polls: [approvedWithKey] },
      prepare: async (app) => {
        await mkdir(join(app, ".env.example"));
      },
    });
    await run.start();
    const skip = `.env.example: ${join(run.app, ".env.example")} is not a regular file, so setup leaves it unchanged.`;
    expect(run.lines).toContain(skip);
    run.lines.length = 0;
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(run.lines.filter((line) => line === skip)).toHaveLength(1);
    expect(run.lines.indexOf(skip)).toBeLessThan(
      run.lines.findIndex((line) => line.startsWith("Waiting for approval")),
    );
    expect(run.lines).toContain("Lemma setup finished.");
  });

  it("accepts any coding agent as `other`, announcing before approval that it prints the lemma server", async () => {
    const run = await setUp({
      api: { polls: [approvedWithKey] },
      interactive: true,
    });
    await run.start({ harness: "other" });
    expect(run.api.startBody()).toMatchObject({ harness: "other" });
    expect(printed(run)).toContain(
      "Approve connecting your coding agent to Lemma",
    );
    const reason =
      "setup has no documented MCP config format for your coding agent";
    expect(printed(run)).toContain(
      `MCP: ${reason}. After approval, setup prints the \`lemma\` server for you to add to your coding agent's MCP servers.`,
    );
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    const added = run.lines.indexOf(
      `MCP: ${reason}. Add this \`lemma\` server to your coding agent's MCP servers:`,
    );
    expect(JSON.parse(run.lines[added + 1] ?? "")).toEqual({
      mcpServers: { lemma: { url: "https://api.uselemma.ai/mcp/" } },
    });
    expect(run.lines[added + 2]).toBe(
      "Once it's added, to sign in to Lemma as yourself, follow your coding agent's steps for an MCP server that asks you to sign in.",
    );
    expect(run.interactiveCalls).toEqual([]);
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it("plans a Codex lemma server defined inline as a manual add, announces it, and finishes with 0", async () => {
    const inline = '[mcp_servers]\nlemma = { url = "https://old" }\n';
    const run = await setUp({
      api: { polls: [approvedWithKey] },
      interactive: true,
      prepare: async (_app, home) => {
        await mkdir(join(home, ".codex"), { recursive: true });
        await writeFile(join(home, ".codex", "config.toml"), inline);
      },
    });
    await run.start({ harness: "codex" });
    expect(printed(run)).toContain(
      "in a form setup cannot edit (use a `[mcp_servers.lemma]` table), so setup does not edit it. After approval, setup prints the `lemma` server for you to add to Codex's MCP servers.",
    );
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(run.lines).toContain(
      '[mcp_servers.lemma]\nurl = "https://api.uselemma.ai/mcp/"',
    );
    expect(run.lines).toContain(
      `Once it's added, to sign in to Lemma as yourself, run \`(cd ${shellWord(run.app)} && codex mcp login lemma)\` in a terminal.`,
    );
    // The server is not in place, so setup does not run its sign-in.
    expect(run.interactiveCalls).toEqual([]);
    expect(
      await readFile(join(run.home, ".codex", "config.toml"), "utf8"),
    ).toBe(inline);
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it.skipIf(!posix || runsAsRoot)(
    "exits 1 from wait when the MCP write fails, printing the lemma server to add by hand",
    async () => {
      const run = await setUp({
        api: { polls: [approvedWithKey] },
        prepare: async (_app, home) => {
          await mkdir(join(home, ".cursor"), { recursive: true });
        },
      });
      await run.start();
      expect(printed(run)).not.toContain("After approval, setup prints");
      await chmod(join(run.home, ".cursor"), 0o500);
      const error = await rejection(run.wait());
      await chmod(join(run.home, ".cursor"), 0o700);
      expect(error.exitCode).toBe(EXIT_CODES.failure);
      expect(await readFile(join(run.app, ".env"), "utf8")).toContain(
        INGEST_KEY,
      );
      await expect(cursorEntry(run.home)).rejects.toThrow();
      expect(printed(run)).toMatch(
        /MCP: setup could not place the Lemma MCP server \(.+\)\. Add this `lemma` server to Cursor's MCP servers:/,
      );
      expect(printed(run)).toContain(
        `Once it's added, to sign in to Lemma as yourself, run \`(cd ${shellWord(run.app)} && agent mcp login lemma)\` in a terminal, or sign in to \`lemma\` from Cursor's MCP settings.`,
      );
      expect(printed(run)).not.toContain("Lemma setup finished.");
    },
  );
});
