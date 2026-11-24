import { spawn } from "node:child_process";

/** A finished command. `code` is null when the command could not start or was killed. */
export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type RunCommand = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<CommandResult>;

/** Runs a command without a shell, so no argument is ever interpreted. */
export const runCommand: RunCommand = (command, args, cwd) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      resolvePromise({ code: null, stdout: "", stderr: error.message });
    });
    child.once("close", (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });

/** How a command attached to this terminal ended. */
export type InteractiveResult =
  | { kind: "exited"; code: number }
  | { kind: "signaled"; signal: string }
  | { kind: "not-started" };

export type RunInteractive = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<InteractiveResult>;

/** Setup outlives an interrupted child, so it can say what to do next. */
const ignoreInterrupt = () => undefined;

/**
 * Runs a command that talks to the person, such as a coding agent's sign-in,
 * which prints a URL, opens the browser, and waits for it. It inherits
 * setup's stdio: the person's terminal, or under `wait --sign-in` whatever
 * the coding agent gave setup. Like `runCommand`, it runs without a shell.
 * Ctrl-C reaches the child, which shares the terminal, while setup ignores it
 * until the child ends.
 */
export const runInteractive: RunInteractive = (command, args, cwd) =>
  new Promise((resolvePromise) => {
    process.on("SIGINT", ignoreInterrupt);
    const done = (result: InteractiveResult) => {
      process.off("SIGINT", ignoreInterrupt);
      resolvePromise(result);
    };
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", () => done({ kind: "not-started" }));
    child.once("close", (code, signal) =>
      done(
        code === null
          ? { kind: "signaled", signal: signal ?? "unknown" }
          : { kind: "exited", code },
      ),
    );
  });
