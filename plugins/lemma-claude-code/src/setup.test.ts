import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installLocalPlugin, runSetup } from "./setup.js";
import { credentialsPath, readCredentials } from "./storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Lemma Claude Code setup", () => {
  it("installs, requests Claude-scoped device auth, and stores no broad API key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-claude-setup-test-"));
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
    const install = vi.fn(async () => "/claude/cache/lemma-claude-code");
    const open = vi.fn(async () => undefined);
    const persistDataDirLocation = vi.fn(async () => undefined);
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
        persistDataDirLocation,
        sleep: async () => undefined,
        output: (message) => output.push(message),
      },
    );

    expect(install).toHaveBeenCalledWith("/checkout/lemma");
    expect(persistDataDirLocation).toHaveBeenCalledWith(dataDir);
    expect(open).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "claude-code",
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

  it("refreshes an existing local installation idempotently", async () => {
    const result = (code: number, stdout: string) => ({
      code,
      stdout,
      output: stdout,
    });
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(result(1, "marketplace already exists"))
      .mockResolvedValueOnce(
        result(
          0,
          JSON.stringify([
            { name: "lemma-local", source: "directory", path: "/old/checkout" },
          ]),
        ),
      )
      .mockResolvedValueOnce(result(0, "removed"))
      .mockResolvedValueOnce(result(0, "added"))
      .mockResolvedValueOnce(
        result(
          0,
          JSON.stringify([
            {
              id: "lemma-claude-code@lemma-local",
              scope: "user",
              installPath: "/old/cache/lemma-claude-code",
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(result(0, "uninstalled"))
      .mockResolvedValueOnce(result(0, "installed"))
      .mockResolvedValueOnce(
        result(
          0,
          JSON.stringify([
            {
              id: "lemma-claude-code@lemma-local",
              scope: "user",
              installPath: "/new/cache/lemma-claude-code",
            },
          ]),
        ),
      );

    await expect(installLocalPlugin("/new/checkout", runCommand)).resolves.toBe(
      resolve("/new/cache/lemma-claude-code"),
    );
    expect(runCommand.mock.calls.map(([, args]) => args)).toEqual([
      ["plugin", "marketplace", "add", "/new/checkout", "--scope", "user"],
      ["plugin", "marketplace", "list", "--json"],
      ["plugin", "marketplace", "remove", "lemma-local"],
      ["plugin", "marketplace", "add", "/new/checkout", "--scope", "user"],
      ["plugin", "list", "--json"],
      [
        "plugin",
        "uninstall",
        "lemma-claude-code@lemma-local",
        "--scope",
        "user",
        "--keep-data",
      ],
      ["plugin", "install", "lemma-claude-code@lemma-local", "--scope", "user"],
      ["plugin", "list", "--json"],
    ]);
  });

  it("rejects invalid credential state without echoing its contents", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-claude-setup-test-"));
    temporaryDirectories.push(dataDir);
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      credentialsPath(dataDir),
      JSON.stringify({ accessToken: "secret-that-must-not-leak" }),
    );
    await expect(readCredentials(dataDir)).rejects.toThrow(
      "Lemma Claude Code credentials are invalid",
    );
    await expect(readCredentials(dataDir)).rejects.not.toThrow(
      "secret-that-must-not-leak",
    );
  });
});
