import { readFile } from "node:fs/promises";

import { afterEach, expect } from "vitest";

import type { RunCommand } from "../command.js";
import type { SetupEnvironment } from "../context.js";
import { SetupError } from "../errors.js";
import { cursorConfigPath } from "../mcp/paths.js";
import { setupPaths } from "../setup-paths.js";
import { runStart, type StartOptions } from "../start.js";
import { runWait } from "../wait.js";
import { approved, MockApi, type MockApiOptions } from "./mock-api.js";
import { temporaryDirectories } from "./temp.js";

/** Root ignores file modes, so a read-only directory does not fail a write. */
export const runsAsRoot = process.getuid?.() === 0;
export const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
export const INGEST_KEY = "lemma_sk_ingest_0123456789abcdef";
export const MCP_KEY = "lemma_sk_admin_fedcba9876543210";
export const EXISTING_KEY = "lemma_sk_existing_00112233445566";

export const approvedWithKeys = approved({
  project_id: PROJECT_ID,
  agent_name: "support-bot",
  harness: "cursor",
  ingest_key: INGEST_KEY,
  mcp_key: MCP_KEY,
});

export type SetupRun = {
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

export type SetupRunInput = {
  api?: MockApiOptions;
  prepare?: (app: string, home: string) => Promise<void>;
  gitIgnored?: boolean;
};

/**
 * `start` and `wait` runs against a local mock API, each in its own app and
 * home directories, on a clock only `sleep` advances. The mock APIs and
 * directories are removed after each test of the calling file.
 */
export function setupRuns(): {
  setUp: (input: SetupRunInput) => Promise<SetupRun>;
  temporaryDirectory: () => Promise<string>;
} {
  const temporaryDirectory = temporaryDirectories("lemma-setup-e2e-");
  const apis: MockApi[] = [];
  afterEach(async () => {
    await Promise.all(apis.splice(0).map((api) => api.close()));
  });

  async function setUp(input: SetupRunInput): Promise<SetupRun> {
    const api = await new MockApi(input.api ?? {}).listen();
    apis.push(api);
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
    return {
      api,
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
            apiUrl: api.url,
            ...options,
          },
          environment,
        ),
      wait: () => runWait(environment),
    };
  }

  return { setUp, temporaryDirectory };
}

export async function rejection(
  promise: Promise<unknown>,
): Promise<SetupError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SetupError);
  return error as SetupError;
}

export function printed(run: SetupRun): string {
  return run.lines.join("\n");
}

export async function cursorEntry(
  home: string,
): Promise<{ headers: { Authorization: string } }> {
  const config = JSON.parse(
    await readFile(cursorConfigPath({ homeDir: home, env: {} }), "utf8"),
  );
  return config.mcpServers.lemma;
}
