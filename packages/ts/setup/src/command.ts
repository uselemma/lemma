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
