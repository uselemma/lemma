import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

/** File modes and symlinks are POSIX checks; Windows runs the rest. */
export const posix = process.platform !== "win32";

/**
 * A factory for temporary directories (symlinks resolved) that are removed
 * after each test of the calling file.
 */
export function temporaryDirectories(prefix: string): () => Promise<string> {
  const created: string[] = [];
  afterEach(async () => {
    const directories = created.splice(0);
    // A test may leave a directory read-only; removal needs write access.
    await Promise.all(
      directories.map((path) => chmod(path, 0o700).catch(() => undefined)),
    );
    await Promise.all(
      directories.map((path) => rm(path, { recursive: true, force: true })),
    );
  });
  return async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
    created.push(directory);
    return directory;
  };
}
