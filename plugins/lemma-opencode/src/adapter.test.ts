import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Event, Part, UserMessage } from "@opencode-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenCodeAdapter } from "./adapter.js";
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

function userMessage(): UserMessage {
  return {
    id: "message-user-1",
    sessionID: "session-1",
    role: "user",
    time: { created: Date.parse("2026-08-21T01:00:00.000Z") },
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude-sonnet" },
  };
}

function userParts(): Part[] {
  return [
    {
      id: "part-user-1",
      sessionID: "session-1",
      messageID: "message-user-1",
      type: "text",
      text: "Fix the test with api_key=private-key",
    },
  ];
}

describe("OpenCode adapter", () => {
  it("queues one completed turn with sanitized native tool activity", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-adapter-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const messages = [
      { info: userMessage(), parts: userParts() },
      {
        info: {
          id: "message-assistant-1",
          sessionID: "session-1",
          role: "assistant" as const,
          time: {
            created: Date.parse("2026-08-21T01:00:01.000Z"),
            completed: Date.parse("2026-08-21T01:00:04.000Z"),
          },
          parentID: "message-user-1",
          modelID: "claude-sonnet",
          providerID: "anthropic",
          mode: "build",
          path: { cwd: "/repo", root: "/repo" },
          cost: 0,
          tokens: {
            input: 10,
            output: 5,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          finish: "stop",
        },
        parts: [
          {
            id: "part-tool-1",
            sessionID: "session-1",
            messageID: "message-assistant-1",
            type: "tool" as const,
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed" as const,
              input: { command: "pnpm test", token: "must-not-leak" },
              output: "passed with Bearer private-token",
              title: "Run tests",
              metadata: { authorization: "must-not-leak" },
              time: {
                start: Date.parse("2026-08-21T01:00:02.000Z"),
                end: Date.parse("2026-08-21T01:00:03.000Z"),
              },
            },
          },
          {
            id: "part-assistant-1",
            sessionID: "session-1",
            messageID: "message-assistant-1",
            type: "text" as const,
            text: "The test passes with Bearer private-token.",
          },
        ],
      },
    ];
    const sessionMessages = vi.fn(async () => ({ data: messages }));
    const scheduleFlush = vi.fn();
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush,
    });

    await adapter.chatMessage(userMessage(), userParts());
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    expect(sessionMessages).toHaveBeenCalledWith({
      path: { id: "session-1" },
      query: { directory: "/repo" },
    });
    expect(adapter.pendingTurnCount()).toBe(0);
    expect(scheduleFlush).toHaveBeenCalledOnce();
    const entries = await readdir(join(dataDir, "pending"));
    expect(entries).toHaveLength(1);
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", entries[0]), "utf8"),
    ) as {
      turn: {
        harness: string;
        prompt: string;
        response: string;
        tools: Array<{ input?: unknown; output?: unknown }>;
      };
    };
    expect(pending.turn).toMatchObject({
      harness: "opencode",
      prompt: "Fix the test with api_key=[REDACTED]",
      response: "The test passes with [REDACTED]",
      tools: [
        {
          input: { command: "pnpm test" },
          output: {
            title: "Run tests",
            output: "passed with [REDACTED]",
            metadata: {},
          },
        },
      ],
    });
    expect(JSON.stringify(pending)).not.toContain("must-not-leak");
  });

  it("falls back to event-only assembly when chat.message is unavailable", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-events-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const sessionMessages = vi.fn(async () => ({
      data: [
        { info: userMessage(), parts: userParts() },
        {
          info: {
            id: "message-assistant-1",
            sessionID: "session-1",
            role: "assistant" as const,
            time: {
              created: Date.parse("2026-08-21T01:00:01.000Z"),
              completed: Date.parse("2026-08-21T01:00:02.000Z"),
            },
            parentID: "message-user-1",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: {
              input: 10,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [
            {
              id: "part-assistant-1",
              sessionID: "session-1",
              messageID: "message-assistant-1",
              type: "text" as const,
              text: "Done",
            },
          ],
        },
      ],
    }));
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.event({
      type: "message.updated",
      properties: { info: userMessage() },
    } as Event);
    await adapter.event({
      type: "message.part.updated",
      properties: { part: userParts()[0] },
    } as Event);
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    const entries = await readdir(join(dataDir, "pending"));
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", entries[0]), "utf8"),
    ) as { turn: { prompt: string; response: string } };
    expect(pending.turn).toMatchObject({
      prompt: "Fix the test with api_key=[REDACTED]",
      response: "Done",
    });
  });

  it("retains a failed turn when the next user message starts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-retry-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const warnings: string[] = [];
    const writePending = vi
      .fn<typeof writePendingTurn>()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementation(writePendingTurn);
    const sessionMessages = vi.fn(async () => ({
      data: [
        { info: userMessage(), parts: userParts() },
        {
          info: {
            id: "message-assistant-1",
            sessionID: "session-1",
            role: "assistant" as const,
            time: {
              created: Date.parse("2026-08-21T01:00:01.000Z"),
              completed: Date.parse("2026-08-21T01:00:02.000Z"),
            },
            parentID: "message-user-1",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: {
              input: 10,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [
            {
              id: "part-assistant-1",
              sessionID: "session-1",
              messageID: "message-assistant-1",
              type: "text" as const,
              text: "Done",
            },
          ],
        },
      ],
    }));
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
      writePending,
      warn: (message) => warnings.push(message),
    });

    await adapter.chatMessage(userMessage(), userParts());
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    expect(adapter.pendingTurnCount()).toBe(1);
    expect(warnings.join("\n")).toContain("disk unavailable");

    const nextMessage = { ...userMessage(), id: "message-user-2" };
    await adapter.chatMessage(nextMessage, [
      { ...userParts()[0], id: "part-user-2", messageID: nextMessage.id },
    ]);

    expect(writePending).toHaveBeenCalledTimes(2);
    expect(adapter.pendingTurnCount()).toBe(1);
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
  });

  it("assembles multiple user text parts without a session snapshot", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-multipart-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const adapter = createOpenCodeAdapter({
      client: {
        session: { messages: vi.fn(async () => ({ data: [] })) },
      } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.event({
      type: "message.updated",
      properties: { info: userMessage() },
    } as Event);
    for (const part of [
      { ...userParts()[0], text: "First instruction" },
      {
        ...userParts()[0],
        id: "part-user-2",
        text: "Second instruction",
      },
    ]) {
      await adapter.event({
        type: "message.part.updated",
        properties: { part },
      } as Event);
    }
    await adapter.event({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-assistant-1",
          sessionID: "session-1",
          messageID: "message-assistant-1",
          type: "text",
          text: "Done",
        },
      },
    } as Event);
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    const entries = await readdir(join(dataDir, "pending"));
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", entries[0]), "utf8"),
    ) as { turn: { prompt: string } };
    expect(pending.turn.prompt).toBe("First instruction\nSecond instruction");
  });

  it("binds a turn to the credential scope active at capture start", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-scope-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-a",
        credentialId: "credential-a",
        accessToken: "scoped-secret-a",
      },
      { dataDir },
    );
    const sessionMessages = vi.fn(async () => ({
      data: [
        { info: userMessage(), parts: userParts() },
        {
          info: {
            id: "message-assistant-1",
            sessionID: "session-1",
            role: "assistant" as const,
            time: {
              created: Date.parse("2026-08-21T01:00:01.000Z"),
              completed: Date.parse("2026-08-21T01:00:02.000Z"),
            },
            parentID: "message-user-1",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: {
              input: 10,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [
            {
              id: "part-assistant-1",
              sessionID: "session-1",
              messageID: "message-assistant-1",
              type: "text" as const,
              text: "Done",
            },
          ],
        },
      ],
    }));
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.chatMessage(userMessage(), userParts());
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-b",
        credentialId: "credential-b",
        accessToken: "scoped-secret-b",
      },
      { dataDir },
    );
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    const entries = await readdir(join(dataDir, "pending"));
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", entries[0]), "utf8"),
    ) as { projectId: string; credentialId: string };
    expect(pending).toMatchObject({
      projectId: "project-a",
      credentialId: "credential-a",
    });
  });

  it("deduplicates hook and session-snapshot tool updates", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-dedupe-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const completedTool = {
      id: "part-tool-1",
      sessionID: "session-1",
      messageID: "message-assistant-1",
      type: "tool" as const,
      callID: "call-1",
      tool: "bash",
      state: {
        status: "completed" as const,
        input: { command: "pnpm test" },
        output: "passed",
        title: "Run tests",
        metadata: {},
        time: {
          start: Date.parse("2026-08-21T01:00:02.000Z"),
          end: Date.parse("2026-08-21T01:00:03.000Z"),
        },
      },
    };
    const sessionMessages = vi.fn(async () => ({
      data: [
        { info: userMessage(), parts: userParts() },
        {
          info: {
            id: "message-assistant-1",
            sessionID: "session-1",
            role: "assistant" as const,
            time: {
              created: Date.parse("2026-08-21T01:00:01.000Z"),
              completed: Date.parse("2026-08-21T01:00:04.000Z"),
            },
            parentID: "message-user-1",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: {
              input: 10,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [
            completedTool,
            {
              id: "part-assistant-1",
              sessionID: "session-1",
              messageID: "message-assistant-1",
              type: "text" as const,
              text: "Done",
            },
          ],
        },
      ],
    }));
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.chatMessage(userMessage(), userParts());
    adapter.beforeTool(
      {
        tool: "bash",
        sessionID: "session-1",
        callID: "call-1",
      },
      { command: "pnpm test" },
    );
    adapter.afterTool(
      {
        tool: "bash",
        sessionID: "session-1",
        callID: "call-1",
        args: { command: "pnpm test" },
      },
      { title: "Run tests", output: "passed", metadata: {} },
    );
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);
    await adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);

    const entries = await readdir(join(dataDir, "pending"));
    expect(entries).toHaveLength(1);
    const pending = JSON.parse(
      await readFile(join(dataDir, "pending", entries[0]), "utf8"),
    ) as { turn: { tools: Array<{ toolUseId: string }> } };
    expect(pending.turn.tools).toEqual([
      expect.objectContaining({ toolUseId: "call-1" }),
    ]);
  });

  it("queues active turns during plugin disposal", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-opencode-dispose-"));
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const sessionMessages = vi.fn(async () => ({
      data: [
        { info: userMessage(), parts: userParts() },
        {
          info: {
            id: "message-assistant-1",
            sessionID: "session-1",
            role: "assistant" as const,
            time: {
              created: Date.parse("2026-08-21T01:00:01.000Z"),
              completed: Date.parse("2026-08-21T01:00:02.000Z"),
            },
            parentID: "message-user-1",
            modelID: "claude-sonnet",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: "/repo", root: "/repo" },
            cost: 0,
            tokens: {
              input: 10,
              output: 5,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [
            {
              id: "part-assistant-1",
              sessionID: "session-1",
              messageID: "message-assistant-1",
              type: "text" as const,
              text: "Done",
            },
          ],
        },
      ],
    }));
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.chatMessage(userMessage(), userParts());
    await adapter.dispose();

    expect(adapter.pendingTurnCount()).toBe(0);
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
  });

  it("fails disposal when completed turns still cannot be persisted", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "lemma-opencode-dispose-failure-"),
    );
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    const writePending = vi.fn(async () => {
      throw new Error("disk unavailable");
    });
    const adapter = createOpenCodeAdapter({
      client: {
        session: { messages: vi.fn(async () => ({ data: [] })) },
      } as never,
      directory: "/repo",
      dataDir,
      writePending,
      warn: () => undefined,
    });

    await adapter.chatMessage(userMessage(), userParts());

    await expect(adapter.dispose()).rejects.toThrow(
      "could not persist 1 completed turn during shutdown",
    );
    expect(writePending).toHaveBeenCalledTimes(2);
    expect(adapter.pendingTurnCount()).toBe(1);
  });

  it("joins idle finalization during plugin disposal", async () => {
    const dataDir = await mkdtemp(
      join(tmpdir(), "lemma-opencode-dispose-race-"),
    );
    directories.push(dataDir);
    await writeCredentials(
      {
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "scoped-secret",
      },
      { dataDir },
    );
    let releaseMessages: (() => void) | undefined;
    const messagesReady = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    const sessionMessages = vi.fn(async () => {
      await messagesReady;
      return {
        data: [
          { info: userMessage(), parts: userParts() },
          {
            info: {
              id: "message-assistant-1",
              sessionID: "session-1",
              role: "assistant" as const,
              time: {
                created: Date.parse("2026-08-21T01:00:01.000Z"),
                completed: Date.parse("2026-08-21T01:00:02.000Z"),
              },
              parentID: "message-user-1",
              modelID: "claude-sonnet",
              providerID: "anthropic",
              mode: "build",
              path: { cwd: "/repo", root: "/repo" },
              cost: 0,
              tokens: {
                input: 10,
                output: 5,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
            parts: [
              {
                id: "part-assistant-1",
                sessionID: "session-1",
                messageID: "message-assistant-1",
                type: "text" as const,
                text: "Done",
              },
            ],
          },
        ],
      };
    });
    const adapter = createOpenCodeAdapter({
      client: { session: { messages: sessionMessages } } as never,
      directory: "/repo",
      dataDir,
      scheduleFlush: () => undefined,
    });

    await adapter.chatMessage(userMessage(), userParts());
    const idle = adapter.event({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as Event);
    const disposal = adapter.dispose();
    releaseMessages?.();
    await Promise.all([idle, disposal]);

    expect(sessionMessages).toHaveBeenCalledOnce();
    expect(adapter.pendingTurnCount()).toBe(0);
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
  });
});
