import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  credentialsPath,
  resolveDataDir,
  resolveOpenClawStateDir,
  writeCredentials,
  writeDataDirLocation,
} from "./storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenClaw storage", () => {
  it("uses the legacy state directory only when it already exists", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-home-"));
    directories.push(homeDir);
    await mkdir(join(homeDir, ".clawdbot"));

    expect(resolveOpenClawStateDir({ homeDir, env: {} })).toBe(
      join(homeDir, ".clawdbot"),
    );
    await mkdir(join(homeDir, ".openclaw"));
    expect(resolveOpenClawStateDir({ homeDir, env: {} })).toBe(
      join(homeDir, ".openclaw"),
    );
  });

  it("persists secure credentials and custom data location", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-state-"));
    directories.push(stateDir);
    const dataDir = join(stateDir, "custom-data");
    const options = { stateDir, env: {} };
    await writeDataDirLocation(dataDir, options);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { ...options, dataDir },
    );

    expect(resolveDataDir(options)).toBe(dataDir);
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath({ dataDir }))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("does not silently accept malformed persisted locations", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-state-"));
    directories.push(stateDir);
    await mkdir(join(stateDir, "lemma"), { recursive: true });
    await writeFile(join(stateDir, "lemma", "data-dir-location.json"), "{");

    expect(() => resolveDataDir({ stateDir, env: {} })).toThrow(SyntaxError);
  });
});
