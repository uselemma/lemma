import { stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { browserCommand, runSetup } from "./setup.js";
import { credentialsPath, readCredentials, resolveDataDir } from "./storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Lemma Codex setup", () => {
  it("installs locally, opens browser login, and stores only the scoped credential", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-codex-setup-test-"));
    temporaryDirectories.push(dataDir);
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
    const install = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);
    const output: string[] = [];

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        dataDir,
        marketplaceRoot: "/checkout/lemma",
      },
      {
        fetch: fetchMock,
        installLocalPlugin: install,
        launchBrowser: open,
        sleep: async () => undefined,
        output: (message) => output.push(message),
      },
    );

    expect(install).toHaveBeenCalledWith("/checkout/lemma");
    expect(open).toHaveBeenCalledWith(
      "https://dev.platform.uselemma.ai/connect/coding-harness?user_code=ABCDE-FGHJK",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dev.api.uselemma.ai/coding-harness/device-authorizations",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dev.api.uselemma.ai/coding-harness/device-authorizations/token",
    );
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

  it.each([
    [
      "darwin",
      {},
      "/Users/ray",
      "/Users/ray/Library/Application Support/Lemma/Codex",
    ],
    ["linux", { XDG_STATE_HOME: "/state" }, "/home/ray", "/state/lemma/codex"],
    [
      "win32",
      { LOCALAPPDATA: "C:\\Users\\ray\\AppData\\Local" },
      "C:\\Users\\ray",
      join("C:\\Users\\ray\\AppData\\Local", "Lemma", "Codex"),
    ],
  ] as const)(
    "resolves a private %s data location",
    (platform, env, homeDir, expected) => {
      expect(
        resolveDataDir({
          platform,
          env: env as NodeJS.ProcessEnv,
          homeDir,
        }),
      ).toBe(expected);
    },
  );

  it("uses the native browser launcher on macOS, Linux, and Windows", () => {
    const url = "https://platform.uselemma.ai/connect/coding-harness";
    expect(browserCommand("darwin", url)).toEqual({
      command: "open",
      args: [url],
    });
    expect(browserCommand("linux", url)).toEqual({
      command: "xdg-open",
      args: [url],
    });
    expect(browserCommand("win32", url)).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", url],
    });
  });

  it("rejects plaintext remote API endpoints", async () => {
    await expect(
      runSetup(
        { apiUrl: "http://api.example.test", installPlugin: false },
        { fetch: vi.fn<typeof fetch>() },
      ),
    ).rejects.toThrow("must use HTTPS");
  });
});
