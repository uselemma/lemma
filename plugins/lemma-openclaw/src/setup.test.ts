import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runSetup } from "./setup.js";
import { credentialsPath, resolveDataDir } from "./storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenClaw setup", () => {
  it("authorizes, installs, and configures conversation access", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-setup-"));
    directories.push(stateDir);
    const dataDir = join(stateDir, "custom-data");
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
    const configurePlugin = vi.fn(async () => undefined);

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        dataDir,
        stateDir,
        pluginRoot: "/package/openclaw",
      },
      {
        fetch: fetchMock,
        launchBrowser: async () => undefined,
        sleep: async () => undefined,
        output: (message) => output.push(message),
        installPlugin,
        configurePlugin,
      },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "openclaw",
    });
    expect(installPlugin).toHaveBeenCalledWith(
      "/package/openclaw",
      stateDir,
    );
    expect(configurePlugin).toHaveBeenCalledWith(stateDir);
    expect(installPlugin.mock.invocationCallOrder[0]).toBeLessThan(
      configurePlugin.mock.invocationCallOrder[0],
    );
    expect(output.join("\n")).not.toContain(credentials.accessToken);
    expect(
      JSON.parse(await readFile(credentialsPath({ dataDir }), "utf8")),
    ).toEqual(credentials);
    expect(resolveDataDir({ stateDir, env: {} })).toBe(dataDir);
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath({ dataDir }))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("can rotate credentials without reinstalling the plugin", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-openclaw-setup-"));
    directories.push(dataDir);
    const installPlugin = vi.fn(async () => undefined);
    await runSetup(
      { dataDir, stateDir: dataDir, installPlugin: false },
      {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            Response.json(
              {
                device_code: "device-secret",
                user_code: "ABCDE-FGHJK",
                verification_uri_complete: "https://platform.uselemma.ai/connect",
                expires_in: 600,
                interval: 1,
              },
              { status: 201 },
            ),
          )
          .mockResolvedValueOnce(
            Response.json({
              status: "approved",
              access_token: "scoped-secret",
              credential_id: "credential-1",
              project_id: "project-1",
            }),
          ),
        launchBrowser: async () => undefined,
        sleep: async () => undefined,
        output: () => undefined,
        installPlugin,
      },
    );

    expect(installPlugin).not.toHaveBeenCalled();
  });
});
