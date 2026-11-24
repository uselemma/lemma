import { readFile } from "node:fs/promises";

import { afterEach, expect } from "vitest";

import { DEFAULT_API_URL, lemmaApiUrl, type Fetch } from "../api.js";
import type { InteractiveResult, RunCommand } from "../command.js";
import type { SetupEnvironment } from "../context.js";
import { SetupError } from "../errors.js";
import { cursorConfigPath } from "../mcp/paths.js";
import { setupPaths } from "../setup-paths.js";
import { runStart, type StartOptions } from "../start.js";
import { runWait, type WaitOptions } from "../wait.js";
import { approved, MockApi, type MockApiOptions } from "./mock-api.js";
import { temporaryDirectories } from "./temp.js";

/** Root ignores file modes, so a read-only directory does not fail a write. */
export const runsAsRoot = process.getuid?.() === 0;
export const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
export const INGEST_KEY = "lemma_sk_ingest_0123456789abcdef";
export const EXISTING_KEY = "lemma_sk_existing_00112233445566";
/** The `lemma` server setup writes for a production run. */
export const PRODUCTION_MCP_ENTRY = { url: `${DEFAULT_API_URL}/mcp/` };

export const approvedWithKey = approved({
  project_id: PROJECT_ID,
  agent_name: "support-bot",
  harness: "cursor",
  ingest_key: INGEST_KEY,
});

/** One command the interactive runner was asked to run. */
export type InteractiveCall = { argv: string[]; cwd: string };

export type SetupRun = {
  api: MockApi;
  app: string;
  home: string;
  lines: string[];
  opened: string[];
  /**
   * The sign-in commands setup ran, at a terminal or under `--sign-in`;
   * never spawned.
   */
  interactiveCalls: InteractiveCall[];
  environment: SetupEnvironment;
  start: (options?: Partial<StartOptions>) => Promise<void>;
  /** `wait`, without `--sign-in` unless the options say so. */
  wait: (options?: WaitOptions) => ReturnType<typeof runWait>;
  pendingPath: string;
};

export type SetupRunInput = {
  api?: MockApiOptions;
  prepare?: (app: string, home: string) => Promise<void>;
  gitIgnored?: boolean;
  /** Whether a person is at the terminal; off by default, as when a coding agent runs setup. */
  interactive?: boolean;
  /** How the sign-in command ends; it exits with 0 by default. */
  signInResult?: InteractiveResult;
};

/**
 * Sends requests for the production API to the mock instead, so a run can
 * use the production URL, as customers do, and still reach the mock.
 */
function productionToMock(mockUrl: string): Fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const target = url.startsWith(`${DEFAULT_API_URL}/`)
      ? `${mockUrl}${url.slice(DEFAULT_API_URL.length)}`
      : url;
    return fetch(
      input instanceof Request ? new Request(target, input) : target,
      init,
    );
  };
}

/**
 * `start` and `wait` runs against a local mock API, each in its own app and
 * home directories, on a clock only `sleep` advances. `start` uses the
 * production URL unless a test passes the mock's own `api.url`, which setup
 * treats as a non-production API. The mock APIs and directories are removed
 * after each test of the calling file.
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
    const interactiveCalls: InteractiveCall[] = [];
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
      fetch: productionToMock(api.url),
      launchBrowser: async (url) => {
        opened.push(url);
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      now: () => clock,
      output: (line) => lines.push(line),
      run,
      interactive: input.interactive ?? false,
      runInteractive: async (command, args, cwd) => {
        interactiveCalls.push({ argv: [command, ...args], cwd });
        return input.signInResult ?? { kind: "exited", code: 0 };
      },
    };
    return {
      api,
      app,
      home,
      lines,
      opened,
      interactiveCalls,
      environment,
      pendingPath: setupPaths(home, app).pending,
      start: (options = {}) =>
        runStart(
          {
            harness: "cursor",
            projectName: "Support bot",
            agentName: "support-bot",
            openBrowser: true,
            apiUrl: lemmaApiUrl(DEFAULT_API_URL, "--api-url"),
            ...options,
          },
          environment,
        ),
      wait: (options = { signIn: false }) => runWait(options, environment),
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

export async function cursorEntry(home: string): Promise<unknown> {
  const config = JSON.parse(
    await readFile(cursorConfigPath({ homeDir: home, env: {} }), "utf8"),
  );
  return config.mcpServers.lemma;
}
