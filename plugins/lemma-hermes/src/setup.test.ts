import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  credentialsPath,
  resolveDataDir,
  writeDataDirLocation,
} from "./credentials.js";
import { installHermesPlugin, runSetup } from "./setup.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Hermes setup", () => {
  it("requests Hermes-scoped authorization without printing the credential", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-hermes-setup-"));
    directories.push(dataDir);
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
            interval: 1,
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
    const output: string[] = [];
    const installPlugin = vi.fn(async () => undefined);
    const enablePlugin = vi.fn(async () => undefined);

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        dataDir,
        homeDir: dataDir,
      },
      {
        fetch: fetchMock,
        launchBrowser: async () => undefined,
        sleep: async () => undefined,
        output: (message) => output.push(message),
        installPlugin,
        enablePlugin,
      },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "hermes",
    });
    expect(installPlugin).toHaveBeenCalledOnce();
    expect(enablePlugin).toHaveBeenCalledWith(join(dataDir, ".hermes"));
    expect(installPlugin.mock.invocationCallOrder[0]).toBeLessThan(
      enablePlugin.mock.invocationCallOrder[0],
    );
    expect(output.join("\n")).not.toContain(credentials.accessToken);
    expect(
      JSON.parse(await readFile(credentialsPath({ dataDir }), "utf8")),
    ).toEqual(credentials);
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath({ dataDir }))).mode & 0o777).toBe(
        0o600,
      );
    }
    expect(resolveDataDir({ homeDir: dataDir, env: {} })).toBe(dataDir);
  });

  it("reinstalls only the Lemma plugin directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "lemma-hermes-install-"));
    directories.push(root);
    const source = join(root, "source");
    const hermesHome = join(root, "hermes-home");
    const target = join(hermesHome, "plugins", "lemma");
    await mkdir(source, { recursive: true });
    await mkdir(join(hermesHome, "plugins", "unrelated"), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "plugin.yaml"), "name: lemma\n");
    await writeFile(join(target, "stale.txt"), "stale\n");
    await writeFile(
      join(hermesHome, "plugins", "unrelated", "plugin.yaml"),
      "name: unrelated\n",
    );
    await writeFile(join(hermesHome, "config.yaml"), "theme: dark\n");

    await installHermesPlugin(source, target);
    await installHermesPlugin(source, target);

    expect(await readFile(join(target, "plugin.yaml"), "utf8")).toBe(
      "name: lemma\n",
    );
    await expect(readFile(join(target, "stale.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(
        join(hermesHome, "plugins", "unrelated", "plugin.yaml"),
        "utf8",
      ),
    ).toBe("name: unrelated\n");
    expect(await readFile(join(hermesHome, "config.yaml"), "utf8")).toBe(
      "theme: dark\n",
    );
  });

  it("persists a custom data directory for later Hermes processes", async () => {
    const hermesHome = await mkdtemp(join(tmpdir(), "lemma-hermes-home-"));
    directories.push(hermesHome);
    const customDataDir = join(hermesHome, "custom-state");
    const options = { homeDir: hermesHome, env: {} };

    await writeDataDirLocation(customDataDir, options);

    expect(resolveDataDir(options)).toBe(customDataDir);
    if (process.platform !== "win32") {
      expect(
        (
          await stat(join(hermesHome, ".hermes", "lemma", "data-dir-location.json"))
        ).mode & 0o777,
      ).toBe(0o600);
    }
  });
});
