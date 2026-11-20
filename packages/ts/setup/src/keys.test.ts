import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cursorConfigPath } from "./mcp/paths.js";
import {
  approved,
  keyDescription,
  type MockApiOptions,
} from "./testing/mock-api.js";
import {
  approvedWithKeys,
  cursorEntry,
  EXISTING_KEY,
  INGEST_KEY,
  MCP_KEY,
  printed,
  PROJECT_ID,
  setupRuns,
} from "./testing/setup-run.js";

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
          mcp_key: MCP_KEY,
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
        polls: [approvedWithKeys],
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

  async function withCursorKey(
    apiOptions: MockApiOptions,
    authorization = `Bearer ${EXISTING_MCP_KEY}`,
  ) {
    return setUp({
      api: apiOptions,
      prepare: async (_app, home) => {
        const path = cursorConfigPath({ homeDir: home, env: {} });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
          path,
          JSON.stringify({
            mcpServers: {
              lemma: {
                url: "https://api.uselemma.ai/mcp/",
                headers: { Authorization: authorization },
              },
            },
          }),
        );
      },
    });
  }

  it("reports and keeps an MCP key /auth/key describes as an organization admin key, checking both keys before starting", async () => {
    const run = await setUp({
      api: {
        keys: {
          [EXISTING_MCP_KEY]: keyDescription(TENANT_ID, null, "admin"),
          [EXISTING_KEY]: keyDescription(TENANT_ID, PROJECT_ID, "ingest"),
        },
        polls: [
          approved({ project_id: PROJECT_ID, agent_name: "support-bot" }),
        ],
      },
      prepare: async (app, home) => {
        await writeFile(join(app, ".env"), envWithKey);
        const path = cursorConfigPath({ homeDir: home, env: {} });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
          path,
          JSON.stringify({
            mcpServers: {
              lemma: {
                url: "https://x/mcp/",
                headers: { Authorization: `Bearer ${EXISTING_MCP_KEY}` },
              },
            },
          }),
        );
      },
    });
    await run.start();
    expect(run.api.paths()).toEqual([
      "GET /auth/key",
      "GET /auth/key",
      "POST /setup/device-authorizations",
    ]);
    expect(run.api.startBody()).toMatchObject({
      existing_ingest_key_project_id: PROJECT_ID,
      existing_mcp_key_tenant_id: TENANT_ID,
    });
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    expect((await cursorEntry(run.home)).headers.Authorization).toBe(
      `Bearer ${EXISTING_MCP_KEY}`,
    );
    expect(printed(run)).toContain("kept Cursor's `lemma` server");
    expect(printed(run)).not.toContain(EXISTING_MCP_KEY);
  });

  it.each([
    ["the key is not an admin key", keyDescription(TENANT_ID, null, "read")],
    [
      "the admin key is limited to one project",
      keyDescription(TENANT_ID, PROJECT_ID, "admin"),
    ],
    ["Lemma rejects the key", undefined],
  ] as const)("does not report the MCP key when %s", async (_case, answer) => {
    const run = await withCursorKey({
      keys: answer ? { [EXISTING_MCP_KEY]: answer } : {},
      polls: [approvedWithKeys],
    });
    await run.start();
    expect(run.api.startBody()).not.toHaveProperty(
      "existing_mcp_key_tenant_id",
    );
    expect(printed(run)).toContain(
      "as an organization admin key. Setup replaces it after approval.",
    );
    await run.wait();
    expect((await cursorEntry(run.home)).headers.Authorization).toBe(
      `Bearer ${MCP_KEY}`,
    );
  });

  it("does not ask Lemma about an MCP key it cannot read, and replaces it", async () => {
    const run = await withCursorKey(
      { polls: [approvedWithKeys] },
      "Bearer ${LEMMA_MCP_KEY}",
    );
    await run.start();
    expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
    expect(printed(run)).toContain(
      "as an organization admin key. Setup replaces it after approval.",
    );
  });

  it("asks nothing for a coding agent without a documented config", async () => {
    const run = await setUp({});
    await run.start({ harness: "other" });
    expect(run.api.paths()).toEqual(["POST /setup/device-authorizations"]);
  });
});
