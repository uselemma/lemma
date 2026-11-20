import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import { SetupError } from "./errors.js";

/** Files setup creates to hold a key or a device code: owner read/write only. */
export const PRIVATE_FILE_MODE = 0o600;

/** The directories under `~/.lemma/setup/` that hold those files. */
const PRIVATE_DIRECTORY_MODE = 0o700;

/** Read permission for the file's group and for everyone else. */
const GROUP_OR_WORLD_READ = 0o044;

/** Why setup does not touch what is at a path; each reads after the path. */
export type NotEditableWhy = "is a symlink" | "is not a regular file";

/** What is at a path, without following a symlink. */
type FileState =
  | { kind: "missing" }
  | { kind: "not-editable"; why: NotEditableWhy }
  | { kind: "file"; contents: string; mode: number };

export async function inspectFile(path: string): Promise<FileState> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
  if (stats.isSymbolicLink())
    return { kind: "not-editable", why: "is a symlink" };
  if (!stats.isFile()) {
    return { kind: "not-editable", why: "is not a regular file" };
  }
  return {
    kind: "file",
    contents: await readFile(path, "utf8"),
    mode: stats.mode & 0o777,
  };
}

/**
 * The file's contents and mode, or null when it does not exist. Refuses a
 * symlink, so nothing setup reads can point elsewhere.
 */
export async function readRegularFile(
  path: string,
): Promise<{ contents: string; mode: number } | null> {
  const state = await inspectFile(path);
  switch (state.kind) {
    case "missing":
      return null;
    case "not-editable":
      throw new SetupError(`${path} ${state.why}, so setup does not read it`);
    case "file":
      return { contents: state.contents, mode: state.mode };
  }
}

/**
 * Replaces `path` through a temporary file and a rename. A rename replaces a
 * symlink planted after a check instead of following it, a reader never
 * sees a half-written file, and on every platform the old file stays until
 * the new one takes its place.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
  mode: number,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode,
      flag: "wx",
    });
    // The process umask narrows the mode passed at creation. Set before the
    // rename, the file appears with its final mode, and a failed chmod
    // leaves the old file in place.
    if (process.platform !== "win32") await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Writes a file only its owner can read, in a directory only its owner can open. */
export async function writePrivateFile(
  path: string,
  contents: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await writeFileAtomic(path, contents, PRIVATE_FILE_MODE);
}

/** One rule for every file that receives a key: group or world read access is too much. */
export function othersCanRead(mode: number): boolean {
  return (mode & GROUP_OR_WORLD_READ) !== 0;
}

export function othersCanReadWarning(
  path: string,
  mode: number,
  holds: string,
): string {
  return `Warning: other users on this machine can read ${path} (mode ${mode.toString(8).padStart(3, "0")}), which holds ${holds}. Run \`chmod 600 ${path}\` to keep it private.`;
}
