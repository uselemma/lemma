import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completeCodingAgentTurn,
  startCodingAgentTurn,
} from "@uselemma/tracing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireFlushLock, flushPendingTurns } from "./flush.js";
import { writePendingTurn } from "./pending.js";
import { writeCredentials } from "./storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("OpenCode pending delivery", () => {
  it("allows only one process to reclaim a stale lock", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-lock-"));
    directories.push(dataDir);
    const lockPath = join(dataDir, "flush.lock");
    await mkdir(lockPath);
    await writeFile(
      join(lockPath, "owner.json"),
      `${JSON.stringify({ pid: 2_147_483_647, id: "dead-owner" })}\n`,
    );
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    const results = await Promise.all([
      acquireFlushLock(dataDir),
      acquireFlushLock(dataDir),
    ]);
    const owners = results.filter(
      (release): release is () => Promise<void> => release !== null,
    );
    expect(owners).toHaveLength(1);
    expect(await acquireFlushLock(dataDir)).toBeNull();
    await owners[0]();
  });

  it("retains a failed delivery and removes it after a later success", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-flush-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "10000000-0000-0000-0000-000000000001",
        credentialId: "credential-1",
        accessToken: "lemma_ci_scoped-secret",
      },
      { dataDir },
    );
    await writePendingTurn(
      completeCodingAgentTurn(
        startCodingAgentTurn({
          harness: "opencode",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "Fix the test",
          startedAt: "2026-08-21T01:00:00.000Z",
          model: "claude-sonnet",
          provider: "anthropic",
        }),
        {
          response: "The test now passes.",
          endedAt: "2026-08-21T01:00:03.000Z",
        },
      ),
      {
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "10000000-0000-0000-0000-000000000001",
        credentialId: "credential-1",
      },
      { dataDir },
    );
    const warnings: string[] = [];
    const failedFetch = vi.fn(async () =>
      Response.json({ detail: "private-body" }, { status: 500 }),
    );

    expect(
      await flushPendingTurns({
        dataDir,
        fetch: failedFetch,
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
    expect(warnings.join("\n")).not.toContain("private-body");

    const successfulFetch = vi.fn(async () =>
      Response.json({}, { status: 201 }),
    );
    expect(await flushPendingTurns({ dataDir, fetch: successfulFetch })).toBe(
      1,
    );
    expect(await readdir(join(dataDir, "pending"))).toEqual([]);
    expect(successfulFetch).toHaveBeenCalledWith(
      "https://dev.api.uselemma.ai/traces/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer lemma_ci_scoped-secret",
        }),
      }),
    );
  });

  it("retains a trace after credentials rotate to another scope", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-rotation-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-b",
        credentialId: "credential-b",
        accessToken: "lemma_ci_scoped-secret-b",
      },
      { dataDir },
    );
    await writePendingTurn(
      completeCodingAgentTurn(
        startCodingAgentTurn({
          harness: "opencode",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "Keep the original project scope",
          startedAt: "2026-08-21T01:00:00.000Z",
        }),
        {
          response: "Done",
          endedAt: "2026-08-21T01:00:03.000Z",
        },
      ),
      {
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-a",
        credentialId: "credential-a",
      },
      { dataDir },
    );
    const fetchMock = vi.fn<typeof fetch>();
    const warnings: string[] = [];

    expect(
      await flushPendingTurns({
        dataDir,
        fetch: fetchMock,
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
    expect(warnings.join("\n")).toContain("retained a trace for retry");
  });

  it("delivers a trace after credentials rotate within the same scope", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-same-scope-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-a",
        credentialId: "credential-new",
        accessToken: "lemma_ci_scoped-secret-new",
      },
      { dataDir },
    );
    await writePendingTurn(
      completeCodingAgentTurn(
        startCodingAgentTurn({
          harness: "opencode",
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "Deliver after credential rotation",
          startedAt: "2026-08-21T01:00:00.000Z",
        }),
        { response: "Done", endedAt: "2026-08-21T01:00:03.000Z" },
      ),
      {
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-a",
        credentialId: "credential-old",
      },
      { dataDir },
    );
    const fetchMock = vi.fn(async () => Response.json({}, { status: 201 }));

    expect(await flushPendingTurns({ dataDir, fetch: fetchMock })).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dev.api.uselemma.ai/traces/ingest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer lemma_ci_scoped-secret-new",
        }),
      }),
    );
    expect(await readdir(join(dataDir, "pending"))).toEqual([]);
  });

  it("stops at the total flush deadline and leaves later traces queued", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-deadline-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-a",
        credentialId: "credential-a",
        accessToken: "lemma_ci_scoped-secret",
      },
      { dataDir },
    );
    for (const turnId of ["turn-1", "turn-2"]) {
      await writePendingTurn(
        completeCodingAgentTurn(
          startCodingAgentTurn({
            harness: "opencode",
            sessionId: "session-1",
            turnId,
            prompt: turnId,
            startedAt: "2026-08-21T01:00:00.000Z",
          }),
          { response: "Done", endedAt: "2026-08-21T01:00:03.000Z" },
        ),
        {
          apiUrl: "https://dev.api.uselemma.ai",
          projectId: "project-a",
          credentialId: "credential-a",
        },
        { dataDir },
      );
    }
    let clock = 0;
    const fetchMock = vi.fn(async () => {
      clock = 10;
      return Response.json({}, { status: 201 });
    });

    expect(
      await flushPendingTurns({
        dataDir,
        fetch: fetchMock,
        now: () => clock,
        timeoutMilliseconds: 10,
      }),
    ).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
  });
});
