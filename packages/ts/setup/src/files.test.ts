import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunCommand } from "./command.js";
import { failureReason, SetupError } from "./errors.js";
import {
  inspectFile,
  othersCanRead,
  othersCanReadWarning,
  readRegularFile,
  writeFileAtomic,
  writePrivateFile,
} from "./files.js";
import { gitRoot, isGitIgnored } from "./git.js";
import { posix, temporaryDirectories } from "./testing/temp.js";

const tempDir = temporaryDirectories("lemma-setup-files-");

describe("files", () => {
  it("tells a missing path, a symlink, a directory, and a file apart", async () => {
    const directory = await tempDir();
    await writeFile(join(directory, "file"), "x");
    await mkdir(join(directory, "dir"));
    expect(await inspectFile(join(directory, "missing"))).toEqual({
      kind: "missing",
    });
    expect(await inspectFile(join(directory, "dir"))).toEqual({
      kind: "not-editable",
      why: "is not a regular file",
    });
    expect(await inspectFile(join(directory, "file"))).toMatchObject({
      kind: "file",
      contents: "x",
    });
    if (posix) {
      await symlink(join(directory, "file"), join(directory, "link"));
      expect(await inspectFile(join(directory, "link"))).toEqual({
        kind: "not-editable",
        why: "is a symlink",
      });
      await expect(readRegularFile(join(directory, "link"))).rejects.toThrow(
        SetupError,
      );
    }
  });

  it.skipIf(!posix)(
    "writes the exact mode and replaces an existing file",
    async () => {
      const path = join(await tempDir(), "config");
      await writeFile(path, "old");
      await writeFileAtomic(path, "new", 0o640);
      expect(await readFile(path, "utf8")).toBe("new");
      expect((await stat(path)).mode & 0o777).toBe(0o640);
    },
  );

  it.skipIf(!posix)(
    "writes private files owner-only in owner-only directories",
    async () => {
      const path = join(await tempDir(), "a", "b", "secret.json");
      await writePrivateFile(path, "{}");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
    },
  );

  it("treats group or world read access as readable by others, with one warning format", () => {
    expect(othersCanRead(0o600)).toBe(false);
    expect(othersCanRead(0o640)).toBe(true);
    expect(othersCanRead(0o604)).toBe(true);
    expect(othersCanReadWarning("/home/a/.env", 0o644, "the ingest key")).toBe(
      "Warning: other users on this machine can read /home/a/.env (mode 644), which holds the ingest key. Run `chmod 600 /home/a/.env` to keep it private.",
    );
  });

  it.skipIf(!posix)("keeps a file's mode when told to", async () => {
    const path = join(await tempDir(), "config");
    await writeFile(path, "old");
    await chmod(path, 0o644);
    await writeFileAtomic(path, "new", (await stat(path)).mode & 0o777);
    expect((await stat(path)).mode & 0o777).toBe(0o644);
  });
});

describe("git", () => {
  function runReturning(
    code: number | null,
    stdout = "",
  ): {
    run: RunCommand;
    calls: Array<{ command: string; args: string[]; cwd: string }>;
  } {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    return {
      calls,
      run: async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return { code, stdout, stderr: "" };
      },
    };
  }

  it("maps check-ignore exit codes, and a missing git to unknown", async () => {
    const ignored = runReturning(0);
    await expect(isGitIgnored("/app/.env", ignored.run)).resolves.toBe(true);
    expect(ignored.calls[0]).toEqual({
      command: "git",
      args: ["check-ignore", "--quiet", "--", ".env"],
      cwd: "/app",
    });
    await expect(isGitIgnored("/app/.env", runReturning(1).run)).resolves.toBe(
      false,
    );
    await expect(
      isGitIgnored("/app/.env", runReturning(128).run),
    ).resolves.toBeNull();
    await expect(
      isGitIgnored("/app/.env", runReturning(null).run),
    ).resolves.toBeNull();
  });

  it("finds the work tree root, or null outside one", async () => {
    await expect(
      gitRoot("/repo/apps/web", runReturning(0, "/repo\n").run),
    ).resolves.toBe("/repo");
    await expect(
      gitRoot("/scratch", runReturning(128).run),
    ).resolves.toBeNull();
  });
});

describe("failure reasons", () => {
  it("shows a setup error or a system error, and nothing else", async () => {
    expect(failureReason(new SetupError("no pending setup"))).toBe(
      "no pending setup",
    );
    const systemError = await readFile("/nonexistent/lemma-setup").catch(
      (error: unknown) => error,
    );
    expect(failureReason(systemError)).toContain("ENOENT");
    expect(failureReason(new Error("Bearer lemma_sk_secret"))).toBe(
      "an unexpected error",
    );
  });
});
