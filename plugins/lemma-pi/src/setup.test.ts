import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialsPath } from "./credentials.js";
import { runSetup } from "./setup.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Pi setup", () => {
  it("requests Pi-scoped authorization and never prints the credential", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-pi-setup-"));
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
    const open = vi.fn(async () => undefined);

    const credentials = await runSetup(
      {
        apiUrl: "https://dev.api.uselemma.ai",
        dataDir,
      },
      {
        fetch: fetchMock,
        launchBrowser: open,
        sleep: async () => undefined,
        output: (message) => output.push(message),
      },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      harness: "pi",
    });
    expect(open).toHaveBeenCalledOnce();
    expect(credentials.accessToken).toBe("lemma_ci_scoped-secret");
    expect(output.join("\n")).not.toContain(credentials.accessToken);
    expect(
      JSON.parse(await readFile(credentialsPath({ dataDir }), "utf8")),
    ).toEqual(credentials);
    if (process.platform !== "win32") {
      expect((await stat(credentialsPath({ dataDir }))).mode & 0o777).toBe(
        0o600,
      );
    }
  });
});
