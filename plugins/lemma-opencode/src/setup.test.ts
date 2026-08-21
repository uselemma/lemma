import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserLaunchCommand,
  installGlobalPlugin,
  runSetup,
} from "./setup.js";
import { credentialsPath, resolveDataDir } from "./storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenCode setup", () => {
  it("uses trusted absolute browser launchers without a shell", () => {
    expect(browserLaunchCommand("https://example.com", "darwin")).toEqual({
      file: "/usr/bin/open",
      args: ["https://example.com"],
    });
    expect(browserLaunchCommand("https://example.com", "linux")).toEqual({
      file: "/usr/bin/xdg-open",
      args: ["https://example.com"],
    });
    expect(
      browserLaunchCommand("https://example.com/&calc.exe", "win32", {
        SystemRoot: "C:\\Windows",
      }),
    ).toEqual({
      file: "C:\\Windows\\System32\\rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://example.com/&calc.exe"],
    });
  });

  it("rejects an untrusted Windows launcher root", () => {
    expect(() =>
      browserLaunchCommand("https://example.com", "win32", {
        SystemRoot: "C:\\Temp",
      }),
    ).toThrow("trusted Windows browser launcher");
  });

  it("authorizes and installs the bundled global plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "lemma-opencode-setup-"));
    directories.push(root);
    const configDir = join(root, "config");
    const dataDir = join(root, "data");
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
    const installPlugin = vi.fn(async () => undefined);
    const output: string[] = [];

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        configDir,
        dataDir,
        openBrowser: false,
        runtimeDir: "/package/runtime",
      },
      {
        fetch: fetchMock,
        installPlugin,
        output: (message) => output.push(message),
        sleep: async () => undefined,
      },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "opencode",
    });
    expect(installPlugin).toHaveBeenCalledWith("/package/runtime", configDir);
    expect(credentials).toMatchObject({
      projectId: "10000000-0000-0000-0000-000000000001",
      credentialId: "credential-1",
    });
    expect(output.join("\n")).toContain("OpenCode is connected");
    const stored = JSON.parse(
      await readFile(credentialsPath({ dataDir }), "utf8"),
    ) as { accessToken: string };
    expect(stored.accessToken).toBe("lemma_ci_scoped-secret");
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath({ dataDir }))).mode & 0o777).toBe(
        0o600,
      );
    }
    expect(resolveDataDir({ configDir, env: {} })).toBe(dataDir);
  });

  it("copies only the bundled plugin runtime into the OpenCode config", async () => {
    const root = await mkdtemp(join(tmpdir(), "lemma-opencode-install-"));
    directories.push(root);
    const runtimeDir = join(root, "runtime");
    const configDir = join(root, "config");
    const pluginsDir = join(configDir, "plugins");
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(pluginsDir, { recursive: true });
    const pluginSource =
      "// @uselemma/opencode managed plugin\nexport const plugin = true;\n";
    await writeFile(join(runtimeDir, "lemma.mjs"), pluginSource);
    await writeFile(
      join(pluginsDir, "unrelated.mjs"),
      "export const keep = true;\n",
    );

    await installGlobalPlugin(runtimeDir, configDir);
    await installGlobalPlugin(runtimeDir, configDir);

    expect(
      await readFile(join(pluginsDir, "uselemma-opencode.js"), "utf8"),
    ).toBe(pluginSource);
    expect(await readFile(join(pluginsDir, "unrelated.mjs"), "utf8")).toBe(
      "export const keep = true;\n",
    );
    if (process.platform !== "win32") {
      expect(
        (await stat(join(pluginsDir, "uselemma-opencode.js"))).mode & 0o777,
      ).toBe(0o600);
    }
  });

  it("rejects unsafe verification URLs before launching a browser", async () => {
    const launchBrowser = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          device_code: "device-secret",
          user_code: "ABCDE-FGHJK",
          verification_uri_complete: "file:///tmp/unsafe",
          expires_in: 600,
          interval: 1,
        },
        { status: 201 },
      ),
    );

    await expect(
      runSetup(
        { apiUrl: "https://dev.api.uselemma.ai" },
        { fetch: fetchMock, launchBrowser },
      ),
    ).rejects.toThrow("Lemma verification URL must use HTTPS");
    expect(launchBrowser).not.toHaveBeenCalled();
  });

  it("refuses to replace unowned or symlinked plugin files", async () => {
    const root = await mkdtemp(join(tmpdir(), "lemma-opencode-owned-install-"));
    directories.push(root);
    const runtimeDir = join(root, "runtime");
    const configDir = join(root, "config");
    const pluginsDir = join(configDir, "plugins");
    const destination = join(pluginsDir, "uselemma-opencode.js");
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(pluginsDir, { recursive: true });
    await writeFile(
      join(runtimeDir, "lemma.mjs"),
      "// @uselemma/opencode managed plugin\nexport const plugin = true;\n",
    );
    await writeFile(destination, "export const owner = 'someone-else';\n");

    await expect(installGlobalPlugin(runtimeDir, configDir)).rejects.toThrow(
      "Refusing to replace an unowned plugin",
    );

    await rm(destination);
    const target = join(root, "target.js");
    await writeFile(target, "keep\n");
    await symlink(target, destination);
    await expect(installGlobalPlugin(runtimeDir, configDir)).rejects.toThrow(
      "Refusing to replace symlinked plugin path",
    );
    expect(await readFile(target, "utf8")).toBe("keep\n");
  });
});
