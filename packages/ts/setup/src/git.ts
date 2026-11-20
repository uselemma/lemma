import { basename, dirname } from "node:path";

import type { RunCommand } from "./command.js";

/**
 * True when git ignores `path`, false when it does not, and null outside a
 * work tree or without git, so a missing git is never reported as a
 * problem. A tracked file is never ignored.
 */
export async function isGitIgnored(
  path: string,
  run: RunCommand,
): Promise<boolean | null> {
  const { code } = await run(
    "git",
    ["check-ignore", "--quiet", "--", basename(path)],
    dirname(path),
  );
  if (code === 0) return true;
  if (code === 1) return false;
  return null;
}

/** The work tree root that contains `directory`, or null outside one. */
export async function gitRoot(
  directory: string,
  run: RunCommand,
): Promise<string | null> {
  const { code, stdout } = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    directory,
  );
  const root = stdout.trim();
  return code === 0 && root ? root : null;
}
