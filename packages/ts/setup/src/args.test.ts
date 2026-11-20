import { describe, expect, it } from "vitest";

import { parseCommand, repositoryWithoutCredentials } from "./args.js";
import { EXIT_CODES, SetupError } from "./errors.js";
import { startRequest } from "./start.js";

describe("command-line input", () => {
  const startArgv = (...extra: string[]) => [
    "start",
    "--harness",
    "claude-code",
    "--project-name",
    "  Support bot  ",
    "--agent-name",
    "support-bot",
    ...extra,
  ];

  function usageErrorOf(argv: string[]): SetupError {
    let error: unknown = null;
    try {
      parseCommand(argv);
    } catch (reason) {
      error = reason;
    }
    expect(error).toBeInstanceOf(SetupError);
    expect((error as SetupError).exitCode).toBe(EXIT_CODES.usage);
    expect((error as SetupError).message).toContain("Usage:");
    return error as SetupError;
  }

  it("returns fully validated start options: trimmed, normalized, credentials stripped", () => {
    expect(
      parseCommand(
        startArgv(
          "--org",
          "acme-inc-x1y2",
          "--framework",
          " langgraph ",
          "--repository",
          "https://x-access-token:ghp_secret@github.com/acme/bot.git",
          "--api-url",
          "http://localhost:8000/",
          "--no-browser",
        ),
      ),
    ).toEqual({
      kind: "start",
      options: {
        harness: "claude-code",
        projectName: "Support bot",
        agentName: "support-bot",
        openBrowser: false,
        apiUrl: "http://localhost:8000",
        repository: "https://github.com/acme/bot.git",
        framework: "langgraph",
        org: "acme-inc-x1y2",
      },
    });
    expect(parseCommand(startArgv())).toMatchObject({
      options: { apiUrl: "https://api.uselemma.ai", openBrowser: true },
    });
    expect(parseCommand(["wait"])).toEqual({ kind: "wait" });
    expect(parseCommand(["--version"])).toEqual({ kind: "version" });
    expect(parseCommand(["start", "--help"])).toEqual({ kind: "help" });
  });

  it("maps validated options and the verified key IDs onto the whole start request", () => {
    expect(
      startRequest(
        {
          harness: "cursor",
          projectName: "Support bot",
          agentName: "support-bot",
          openBrowser: true,
          apiUrl: "https://api.uselemma.ai",
          org: "acme-inc-x1y2",
        },
        {
          ingestProjectId: "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11",
          mcpTenantId: null,
        },
      ),
    ).toEqual({
      harness: "cursor",
      inferred: {
        project_name: "Support bot",
        agent_name: "support-bot",
        repository: undefined,
        framework: undefined,
      },
      org_slug: "acme-inc-x1y2",
      existing_ingest_key_project_id: "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11",
      existing_mcp_key_tenant_id: undefined,
    });
  });

  it("treats an empty optional flag like an absent one", () => {
    expect(
      parseCommand(
        startArgv(
          "--org",
          "",
          "--repository",
          " ",
          "--framework",
          "",
          "--api-url",
          "",
        ),
      ),
    ).toMatchObject({
      options: {
        org: undefined,
        repository: undefined,
        framework: undefined,
        apiUrl: "https://api.uselemma.ai",
      },
    });
  });

  it("rejects a missing command, an unknown harness or flag, and wait flags with exit 2 and the usage", () => {
    for (const argv of [
      [],
      ["setup"],
      [
        "start",
        "--harness",
        "windsurf",
        "--project-name",
        "p",
        "--agent-name",
        "a",
      ],
      ["start", "--harness", "cursor", "--project-name", "p"],
      [
        "start",
        "--harness",
        "cursor",
        "--project-name",
        "p",
        "--agent-name",
        "a",
        "--key",
        "x",
      ],
      ["wait", "--harness", "cursor"],
    ]) {
      usageErrorOf(argv);
    }
  });

  it("rejects names the approval page would refuse and an org that is not a slug with exit 2", () => {
    for (const agentName of ["trace", "  ", "!!!", "x".repeat(201)]) {
      usageErrorOf([
        "start",
        "--harness",
        "cursor",
        "--project-name",
        "p",
        "--agent-name",
        agentName,
      ]);
    }
    usageErrorOf([
      "start",
      "--harness",
      "cursor",
      "--project-name",
      " ",
      "--agent-name",
      "a",
    ]);
    expect(usageErrorOf(startArgv("--org", "Acme Inc.")).message).toContain(
      "organization's slug",
    );
  });

  it("rejects a bad --api-url with exit 2 and the usage", () => {
    expect(
      usageErrorOf(startArgv("--api-url", "http://api.example.com")).message,
    ).toContain("--api-url must use HTTPS");
    expect(usageErrorOf(startArgv("--api-url", "not a url")).message).toContain(
      "--api-url is not a valid URL",
    );
  });

  it("strips credentials from a repository URL", () => {
    expect(
      repositoryWithoutCredentials(
        "https://x-access-token:ghp_secret@github.com/acme/bot.git",
      ),
    ).toBe("https://github.com/acme/bot.git");
    expect(repositoryWithoutCredentials("git@github.com:acme/bot.git")).toBe(
      "git@github.com:acme/bot.git",
    );
    expect(repositoryWithoutCredentials("acme/bot")).toBe("acme/bot");
  });
});
