import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import packageJson from "../package.json" with { type: "json" };

import type { Fetch } from "./api.js";
import { launchBrowser } from "./browser.js";
import {
  runCommand,
  runInteractive,
  type RunCommand,
  type RunInteractive,
} from "./command.js";

/** The exact command the skill and the output name, pinned to this release. */
export const SETUP_COMMAND = `npx --yes ${packageJson.name}@${packageJson.version}`;

/** Everything outside the process that setup reads, writes, or calls. */
export type SetupEnvironment = {
  cwd: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  fetch: Fetch;
  launchBrowser: (url: string) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  output: (line: string) => void;
  run: RunCommand;
  /** Whether a person is at this terminal: stdin is a TTY. */
  interactive: boolean;
  runInteractive: RunInteractive;
};

export function defaultEnvironment(): SetupEnvironment {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    env: process.env,
    fetch,
    launchBrowser,
    sleep: (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    now: Date.now,
    output: (line) => console.log(line),
    run: runCommand,
    interactive: process.stdin.isTTY === true,
    runInteractive,
  };
}

/** The app directory with symlinks resolved, so `start` and `wait` agree on it. */
export async function appDirectory(
  environment: SetupEnvironment,
): Promise<string> {
  const directory = resolve(environment.cwd);
  return realpath(directory).catch(() => directory);
}
