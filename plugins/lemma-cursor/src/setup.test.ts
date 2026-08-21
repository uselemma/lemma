import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installLocalPlugin, runSetup } from "./setup.js";
import {
  credentialsPath,
  readCredentials,
} from "./storage.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Cursor setup", () => {
  it("installs and refreshes a local plugin symlink idempotently", async () => {
    const source = await temporaryDirectory("lemma-cursor-source-");
    const plugins = await temporaryDirectory("lemma-cursor-plugins-");
    await mkdir(join(source, ".cursor-plugin"), { recursive: true });
    await writeFile(
      join(source, ".cursor-plugin", "plugin.json"),
      JSON.stringify({ name: "lemma-cursor" }),
    );
    const destination = await installLocalPlugin(source, plugins);
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(resolve(join(destination, ".."), await readlink(destination))).toBe(
      resolve(source),
    );
    await expect(installLocalPlugin(source, plugins)).resolves.toBe(destination);
  });

  it("requests Cursor-scoped auth and stores no broad API key", async () => {
    const dataDir = await temporaryDirectory("lemma-cursor-setup-");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            device_code: "device-secret",
            user_code: "ABCDE-FGHJK",
            verification_uri_complete:
              "https://dev.platform.uselemma.ai/connect/coding-harness?user_code=ABCDE-FGHJK",
            expires_in: 600,
            interval: 5,
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "approved",
          access_token: "lemma_ci_scoped-secret",
          credential_id: "credential-1",
          project_id: "10000000-0000-0000-0000-000000000001",
        }),
      );
    const install = vi.fn(async () => "/home/ray/.cursor/plugins/local/lemma-cursor");
    const open = vi.fn(async () => undefined);
    const persist = vi.fn(async () => undefined);
    const output: string[] = [];

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        dataDir,
        pluginRoot: "/checkout/plugins/lemma-cursor",
      },
      {
        fetch: fetchMock,
        installLocalPlugin: install,
        launchBrowser: open,
        persistDataDirLocation: persist,
        sleep: async () => undefined,
        output: (message) => output.push(message),
      },
    );

    expect(install).toHaveBeenCalledWith(
      "/checkout/plugins/lemma-cursor",
      undefined,
    );
    expect(open).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "cursor",
    });
    expect(credentials).toEqual({
      version: 1,
      apiUrl: "https://dev.api.uselemma.ai",
      projectId: "10000000-0000-0000-0000-000000000001",
      credentialId: "credential-1",
      accessToken: "lemma_ci_scoped-secret",
    });
    await expect(readCredentials(dataDir)).resolves.toEqual(credentials);
    expect(output.join("\n")).not.toContain("lemma_ci_scoped-secret");
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath(dataDir))).mode & 0o777).toBe(0o600);
    }
  });
});
