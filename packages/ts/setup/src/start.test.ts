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
import { DEVICE_CODE, USER_CODE } from "./testing/mock-api.js";
import {
  approvedWithKeys,
  INGEST_KEY,
  MCP_KEY,
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
      existingMcpTenantId: null,
    });
    if (posix) expect((await stat(run.pendingPath)).mode & 0o777).toBe(0o600);
    expect(printed(run)).toContain("npx --yes @uselemma/setup@0.1.0 wait");
    expect(printed(run)).not.toContain(DEVICE_CODE);
  });

  it.skipIf(!posix)(
    "plans a symlinked .env as a private file, says so before approval, and finishes with 0",
    async () => {
      const run = await setUp({
        api: { polls: [approvedWithKeys] },
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
      api: { polls: [approvedWithKeys] },
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

  it("accepts any coding agent as `other`, announcing the private MCP file before approval", async () => {
    const run = await setUp({ api: { polls: [approvedWithKeys] } });
    await run.start({ harness: "other" });
    expect(run.api.startBody()).toMatchObject({ harness: "other" });
    expect(printed(run)).toContain(
      "Approve connecting your coding agent to Lemma",
    );
    const entry = setupPaths(run.home, run.app).savedMcpEntry("other", "json");
    expect(printed(run)).toContain(
      `MCP: setup has no documented MCP config format for your coding agent. After approval, setup saves the Lemma server's entry to ${entry} (readable only by you)`,
    );
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(printed(run)).toContain(
      `The full entry, key included, is in ${entry}`,
    );
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it("plans a Codex lemma server defined inline as the private file, announces it, and finishes with 0", async () => {
    const run = await setUp({
      api: { polls: [approvedWithKeys] },
      prepare: async (_app, home) => {
        await mkdir(join(home, ".codex"), { recursive: true });
        await writeFile(
          join(home, ".codex", "config.toml"),
          '[mcp_servers]\nlemma = { url = "https://old" }\n',
        );
      },
    });
    await run.start({ harness: "codex" });
    const entry = setupPaths(run.home, run.app).savedMcpEntry("codex", "toml");
    expect(printed(run)).toContain(
      `in a form setup cannot edit (use a \`[mcp_servers.lemma]\` table), so setup does not edit it. After approval, setup saves the Lemma server's entry to ${entry}`,
    );
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    await expect(readFile(entry, "utf8")).resolves.toContain(MCP_KEY);
    expect(
      await readFile(join(run.home, ".codex", "config.toml"), "utf8"),
    ).toBe('[mcp_servers]\nlemma = { url = "https://old" }\n');
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it.skipIf(!posix || runsAsRoot)(
    "exits 1 from wait when the admin key falls back to the private file because the write failed",
    async () => {
      const run = await setUp({
        api: { polls: [approvedWithKeys] },
        prepare: async (_app, home) => {
          await mkdir(join(home, ".cursor"), { recursive: true });
        },
      });
      await run.start();
      expect(printed(run)).not.toContain(
        "After approval, setup saves the Lemma server's entry",
      );
      await chmod(join(run.home, ".cursor"), 0o500);
      const error = await rejection(run.wait());
      await chmod(join(run.home, ".cursor"), 0o700);
      expect(error.exitCode).toBe(EXIT_CODES.failure);
      expect(await readFile(join(run.app, ".env"), "utf8")).toContain(
        INGEST_KEY,
      );
      await expect(
        readFile(
          setupPaths(run.home, run.app).savedMcpEntry("cursor", "json"),
          "utf8",
        ),
      ).resolves.toContain(MCP_KEY);
      expect(printed(run)).toContain(
        `MCP: setup could not place the Lemma MCP server (`,
      );
      expect(printed(run)).not.toContain("Lemma setup finished.");
    },
  );
});
