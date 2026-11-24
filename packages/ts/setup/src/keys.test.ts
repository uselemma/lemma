import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "./errors.js";
import { cursorConfigPath } from "./mcp/paths.js";
import {
  approved,
  keyDescription,
  type MockApiOptions,
} from "./testing/mock-api.js";
import {
  approvedWithKey,
  cursorEntry,
  EXISTING_KEY,
  INGEST_KEY,
  printed,
  PRODUCTION_MCP_ENTRY,
  PROJECT_ID,
  rejection,
  runsAsRoot,
  setupRuns,
} from "./testing/setup-run.js";
import { posix } from "./testing/temp.js";

const OTHER_PROJECT_ID = "9b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const TENANT_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const EXISTING_MCP_KEY = "lemma_sk_existing_admin_0011223344";

const { setUp } = setupRuns();

describe("existing keys", () => {
  const envWithKey = `LEMMA_API_KEY=${EXISTING_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`;

  async function withEnv(contents: string, apiOptions: MockApiOptions) {
    return setUp({
      api: apiOptions,
      prepare: async (app) => {
        await writeFile(join(app, ".env"), contents);
      },
    });
  }

  it("reports and keeps an ingest key /auth/key limits to LEMMA_PROJECT_ID", async () => {
    const run = await withEnv(envWithKey, {
      keys: { [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest") },
      polls: [
        approved({
          project_id: PROJECT_ID,
          agent_name: "support-bot",
        }),
      ],
    });
    await run.start();
    expect(run.api.startBody()).toMatchObject({
      existing_ingest_key_project_id: PROJECT_ID,
    });
    expect(run.api.requests[0]).toMatchObject({
      path: "/auth/key",
      headers: { authorization: `Bearer ${EXISTING_KEY}` },
    });
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(await readFile(join(run.app, ".env"), "utf8")).toBe(envWithKey);
    expect(printed(run)).toContain("kept LEMMA_API_KEY");
    expect(printed(run)).not.toContain("can only send traces");
    expect(printed(run)).not.toContain(EXISTING_KEY);
  });

  it("sets LEMMA_BASE_URL beside a kept ingest key when the API isn't production", async () => {
    const run = await withEnv(envWithKey, {
      keys: { [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest") },
      polls: [
        approved({
          project_id: PROJECT_ID,
          agent_name: "support-bot",
        }),
      ],
    });
    await run.start({ apiUrl: run.api.url });
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(await readFile(join(run.app, ".env"), "utf8")).toBe(
      `${envWithKey}LEMMA_BASE_URL=${run.api.url}\n`,
    );
    expect(run.lines).toContain(".env: set LEMMA_BASE_URL.");
    expect(printed(run)).not.toContain(EXISTING_KEY);
  });

  it.skipIf(!posix || runsAsRoot)(
    "exits 1 naming the value when LEMMA_BASE_URL cannot be set beside a kept key",
    async () => {
      const run = await withEnv(envWithKey, {
        keys: {
          [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest"),
        },
        polls: [
          approved({
            project_id: PROJECT_ID,
            agent_name: "support-bot",
          }),
        ],
      });
      await run.start({ apiUrl: run.api.url });
      await chmod(run.app, 0o500);
      const error = await rejection(run.wait()).finally(() =>
        chmod(run.app, 0o700),
      );
      expect(error.exitCode).toBe(EXIT_CODES.failure);
      expect(await readFile(join(run.app, ".env"), "utf8")).toBe(envWithKey);
      expect(printed(run)).toContain(
        `Add LEMMA_BASE_URL=${run.api.url} where the app loads its environment`,
      );
      expect(await cursorEntry(run.home)).toEqual({
        url: `${run.api.url}/mcp/`,
      });
      expect(printed(run)).not.toContain("Lemma setup finished.");
    },
  );

  it.skipIf(!posix || runsAsRoot)(
    "exits 1 saying to remove a leftover LEMMA_BASE_URL a production setup cannot remove beside a kept key",
    async () => {
      const withLeftover = `${envWithKey}LEMMA_BASE_URL=https://dev.api.uselemma.ai\n`;
      const run = await withEnv(withLeftover, {
        keys: {
          [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest"),
        },
        polls: [
          approved({
            project_id: PROJECT_ID,
            agent_name: "support-bot",
          }),
        ],
      });
      await run.start();
      await chmod(run.app, 0o500);
      const error = await rejection(run.wait()).finally(() =>
        chmod(run.app, 0o700),
      );
      expect(error.exitCode).toBe(EXIT_CODES.failure);
      expect(await readFile(join(run.app, ".env"), "utf8")).toBe(withLeftover);
      expect(printed(run)).toContain(
        "Remove LEMMA_BASE_URL from .env, so the kept key reaches the API it belongs to.",
      );
      expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
      expect(printed(run)).not.toContain("Lemma setup finished.");
    },
  );

  it.each([
    ["Lemma rejects the key", undefined],
    [
      "the key is limited to another project",
      keyDescription(TENANT_ID, OTHER_PROJECT_ID, "ingest"),
    ],
    [
      "the key is a read key for the project",
      keyDescription(TENANT_ID, PROJECT_ID, "read"),
    ],
    [
      "the key is an admin key for the project",
      keyDescription(TENANT_ID, PROJECT_ID, "admin"),
    ],
    [
      "the key is not limited to a project",
      keyDescription(TENANT_ID, null, "ingest"),
    ],
    [
      "the answer is malformed",
      { status: 200, body: { tenant_id: TENANT_ID, scope: "ingest" } },
    ],
  ] as const)(
    "does not report the ingest key when %s",
    async (_case, answer) => {
      const run = await withEnv(envWithKey, {
        keys: answer ? { [EXISTING_KEY]: answer } : {},
        polls: [approvedWithKey],
      });
      await run.start();
      expect(run.api.startBody()).not.toHaveProperty(
        "existing_ingest_key_project_id",
      );
      await run.wait();
      expect(await readFile(join(run.app, ".env"), "utf8")).toBe(
        `LEMMA_API_KEY=${INGEST_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
      );
    },
  );

  it("does not check an ingest key without a usable LEMMA_PROJECT_ID", async () => {
    const run = await withEnv(
      `LEMMA_API_KEY=${EXISTING_KEY}\nLEMMA_PROJECT_ID=not-a-uuid\n`,
      {
        keys: {
          [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest"),
        },
      },
    );
    await run.start();
    expect(run.api.paths()).not.toContain("GET /auth/key");
    expect(printed(run)).toContain("has no usable LEMMA_PROJECT_ID");
  });

  async function withCursorServer(lemma: Record<string, unknown>) {
    return setUp({
      api: { polls: [approvedWithKey] },
      interactive: true,
      prepare: async (_app, home) => {
        const path = cursorConfigPath({ homeDir: home, env: {} });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ mcpServers: { lemma } }));
      },
    });
  }

  it.each([
    ["a literal key", `Bearer ${EXISTING_MCP_KEY}`],
    ["an env reference", "Bearer ${LEMMA_MCP_KEY}"],
  ])(
    "leaves a lemma server that sends %s as it is, never asking Lemma about it or signing in",
    async (_case, authorization) => {
      const lemma = {
        url: "https://api.uselemma.ai/mcp/",
        headers: { Authorization: authorization },
      };
      const run = await withCursorServer(lemma);
      await run.start();
      expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
      expect(run.api.startBody()).not.toHaveProperty(
        "existing_mcp_key_tenant_id",
      );
      expect(printed(run)).toContain(
        "MCP: Cursor's `lemma` server sends an API key, so setup leaves it as it is.",
      );
      await expect(run.wait()).resolves.toEqual({ status: "approved" });
      expect(await cursorEntry(run.home)).toEqual(lemma);
      expect(printed(run)).toContain(
        "MCP: kept Cursor's `lemma` server, which sends an API key. To sign in as yourself instead, remove that server and run setup again.",
      );
      expect(run.interactiveCalls).toEqual([]);
      expect(printed(run)).not.toContain("sign in to Lemma as yourself");
      expect(printed(run)).not.toContain(EXISTING_MCP_KEY);
    },
  );

  it("replaces a lemma server that sends no key, and signs in to it", async () => {
    const run = await withCursorServer({ url: "https://old/mcp/" });
    await run.start();
    expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect(await cursorEntry(run.home)).toEqual(PRODUCTION_MCP_ENTRY);
    expect(run.interactiveCalls).toEqual([
      { argv: ["agent", "mcp", "login", "lemma"], cwd: run.app },
    ]);
  });

  it("asks nothing for a coding agent without a documented config", async () => {
    const run = await setUp({});
    await run.start({ harness: "other" });
    expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
  });
});
