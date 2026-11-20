import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RunCommand } from "./command.js";
import type { SetupEnvironment } from "./context.js";
import { EXIT_CODES, SetupError } from "./errors.js";
import { cursorConfigPath } from "./mcp/paths.js";
import type { PendingSetup } from "./pending.js";
import { WAIT_BUDGET_SECONDS } from "./poll.js";
import { setupPaths } from "./setup-paths.js";
import { runStart, type StartOptions } from "./start.js";
import {
  approved,
  denied,
  DEVICE_CODE,
  expired,
  keyDescription,
  MockApi,
  pending,
  plainNotFound,
  slowDown,
  USER_CODE,
  type MockApiOptions,
} from "./testing/mock-api.js";
import { posix, temporaryDirectories } from "./testing/temp.js";
import { runWait } from "./wait.js";

const runsAsRoot = process.getuid?.() === 0;
const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
const OTHER_PROJECT_ID = "9b1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const TENANT_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const INGEST_KEY = "lemma_sk_ingest_0123456789abcdef";
const MCP_KEY = "lemma_sk_admin_fedcba9876543210";
const EXISTING_KEY = "lemma_sk_existing_00112233445566";
const EXISTING_MCP_KEY = "lemma_sk_existing_admin_0011223344";
const UNAVAILABLE =
  "Coding-agent setup isn't available on this Lemma environment yet. Use manual setup in the dashboard.";

const temporaryDirectory = temporaryDirectories("lemma-setup-e2e-");
let api: MockApi | null = null;

afterEach(async () => {
  await api?.close();
  api = null;
});

const approvedWithKeys = approved({
  project_id: PROJECT_ID,
  agent_name: "support-bot",
  harness: "cursor",
  ingest_key: INGEST_KEY,
  mcp_key: MCP_KEY,
});

type Harness = {
  api: MockApi;
  app: string;
  home: string;
  lines: string[];
  opened: string[];
  environment: SetupEnvironment;
  start: (options?: Partial<StartOptions>) => Promise<void>;
  wait: () => ReturnType<typeof runWait>;
  pendingPath: string;
};

async function setUp(input: {
  api?: MockApiOptions;
  prepare?: (app: string, home: string) => Promise<void>;
  gitIgnored?: boolean;
}): Promise<Harness> {
  api = await new MockApi(input.api ?? {}).listen();
  const app = await temporaryDirectory();
  const home = await temporaryDirectory();
  await input.prepare?.(app, home);
  const lines: string[] = [];
  const opened: string[] = [];
  let clock = 1_000_000;
  const run: RunCommand = async (command, args) => {
    if (command === "git" && args[0] === "check-ignore") {
      return {
        code: input.gitIgnored === false ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    }
    if (command === "git") return { code: 128, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const environment: SetupEnvironment = {
    cwd: app,
    homeDir: home,
    env: {},
    fetch,
    launchBrowser: async (url) => {
      opened.push(url);
    },
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    output: (line) => lines.push(line),
    run,
  };
  const mock = api;
  return {
    api: mock,
    app,
    home,
    lines,
    opened,
    environment,
    pendingPath: setupPaths(home, app).pending,
    start: (options = {}) =>
      runStart(
        {
          harness: "cursor",
          projectName: "Support bot",
          agentName: "support-bot",
          openBrowser: true,
          apiUrl: mock.url,
          ...options,
        },
        environment,
      ),
    wait: () => runWait(environment),
  };
}

async function rejection(promise: Promise<unknown>): Promise<SetupError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SetupError);
  return error as SetupError;
}

function printed(run: Harness): string {
  return run.lines.join("\n");
}

async function cursorEntry(
  home: string,
): Promise<{ headers: { Authorization: string } }> {
  const config = JSON.parse(
    await readFile(cursorConfigPath({ homeDir: home, env: {} }), "utf8"),
  );
  return config.mcpServers.lemma;
}

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

describe("wait", () => {
  it("writes .env, .env.example, and the MCP config once approved, reporting each as it lands", async () => {
    const run = await setUp({
      api: { polls: [pending, slowDown, approvedWithKeys] },
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
    expect((await cursorEntry(run.home)).headers.Authorization).toBe(
      `Bearer ${MCP_KEY}`,
    );
    await expect(stat(run.pendingPath)).rejects.toThrow();

    const firstWords = run.lines.slice(1).map((line) => line.split(" ")[0]);
    expect(firstWords.slice(0, 6)).toEqual([
      "Approved.",
      "Project",
      "Agent",
      ".env:",
      "Warning:",
      ".env.example:",
    ]);
    expect(run.lines).toContain("Lemma setup finished.");
    for (const secret of [INGEST_KEY, MCP_KEY, DEVICE_CODE])
      expect(printed(run)).not.toContain(secret);
  });

  it("returns pending within its budget, keeps the pace, and finishes on a later run", async () => {
    const polls = Array.from({ length: 40 }, () => pending);
    const run = await setUp({ api: { polls: [...polls, approvedWithKeys] } });
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

    await expect(run.wait()).resolves.toEqual({ status: "pending" });
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
      await api?.close();
    }
  });

  it.skipIf(!posix || runsAsRoot)(
    "places both keys when the spent pending file cannot be deleted, and keeps the run's exit code",
    async () => {
      const run = await setUp({ api: { polls: [approvedWithKeys] } });
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
      expect((await cursorEntry(run.home)).headers.Authorization).toBe(
        `Bearer ${MCP_KEY}`,
      );
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

  it("announces a private file planned only at wait before polling, and finishes with 0", async () => {
    const run = await setUp({ api: { polls: [approvedWithKeys] } });
    await run.start();
    expect(printed(run)).not.toContain(
      "After approval, setup saves the Lemma server's entry",
    );
    await mkdir(cursorConfigPath({ homeDir: run.home, env: {} }), {
      recursive: true,
    });
    run.lines.length = 0;
    await expect(run.wait()).resolves.toEqual({ status: "approved" });
    const entry = setupPaths(run.home, run.app).savedMcpEntry("cursor", "json");
    const announced = run.lines.findIndex((line) =>
      line.includes(
        `After approval, setup saves the Lemma server's entry to ${entry}`,
      ),
    );
    expect(announced).toBeGreaterThanOrEqual(0);
    expect(announced).toBeLessThan(
      run.lines.findIndex((line) => line.startsWith("Waiting for approval")),
    );
    await expect(readFile(entry, "utf8")).resolves.toContain(MCP_KEY);
    expect(printed(run)).toContain("Lemma setup finished.");
  });

  it("asks for start when no setup is pending in this directory", async () => {
    const run = await setUp({});
    await expect(run.wait()).rejects.toThrow(
      "No setup is waiting for approval in this directory",
    );
    const elsewhere = await setUp({ api: { polls: [approvedWithKeys] } });
    await elsewhere.start();
    const other = await temporaryDirectory();
    await expect(
      runWait({ ...elsewhere.environment, cwd: other }),
    ).rejects.toThrow("No setup is waiting");
    expect(await readdir(dirname(elsewhere.pendingPath))).toHaveLength(1);
  });

  it("still writes the MCP key when Lemma keeps an ingest key this client never reported, then exits 1", async () => {
    const run = await setUp({
      api: {
        polls: [
          approved({
            project_id: PROJECT_ID,
            agent_name: "support-bot",
            mcp_key: MCP_KEY,
          }),
        ],
      },
    });
    await run.start();
    const error = await rejection(run.wait());
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    await expect(stat(join(run.app, ".env"))).rejects.toThrow();
    expect((await cursorEntry(run.home)).headers.Authorization).toBe(
      `Bearer ${MCP_KEY}`,
    );
    expect(printed(run)).toContain("returned no ingest key");
    expect(printed(run)).toContain("added the `lemma` server");
    expect(printed(run)).not.toContain("Lemma setup finished.");
  });

  it.skipIf(!posix || runsAsRoot)(
    "saves the ingest key to a private file when .env cannot be written, writes the MCP key, then exits 1",
    async () => {
      const run = await setUp({ api: { polls: [approvedWithKeys] } });
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
      expect((await cursorEntry(run.home)).headers.Authorization).toBe(
        `Bearer ${MCP_KEY}`,
      );
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
        api: { polls: [approvedWithKeys] },
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

describe("an environment without coding-agent setup", () => {
  it("start says so in one line, exits with 1, and writes nothing", async () => {
    const run = await setUp({
      api: { start: plainNotFound, keys: { [EXISTING_KEY]: plainNotFound } },
      prepare: async (app) => {
        await writeFile(
          join(app, ".env"),
          `LEMMA_API_KEY=${EXISTING_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
        );
      },
    });
    const error = await rejection(run.start());
    expect(error.message).toBe(UNAVAILABLE);
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    expect(run.lines).toEqual([]);
    expect(run.opened).toEqual([]);
    await expect(stat(run.pendingPath)).rejects.toThrow();
    await expect(stat(join(run.app, ".env.example"))).rejects.toThrow();
  });

  it("wait says so when a poll gets a plain 404, exits with 1, and writes nothing", async () => {
    const run = await setUp({ api: { polls: [plainNotFound] } });
    await run.start();
    const saved = await readFile(run.pendingPath, "utf8");
    const error = await rejection(run.wait());
    expect(error.message).toBe(UNAVAILABLE);
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    await expect(stat(join(run.app, ".env"))).rejects.toThrow();
    await expect(
      stat(cursorConfigPath({ homeDir: run.home, env: {} })),
    ).rejects.toThrow();
    expect(await readFile(run.pendingPath, "utf8")).toBe(saved);
  });
});
