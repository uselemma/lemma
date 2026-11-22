import { afterEach, describe, expect, it, vi } from "vitest";

import { lemmaApiUrl } from "./api.js";
import { parseCommand, repositoryWithoutCredentials } from "./args.js";
import { EXIT_CODES, SetupError } from "./errors.js";
import { startRequest } from "./start.js";

const LEMMA_PROJECT_ID = "0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f";

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
          "--project-id",
          ` ${LEMMA_PROJECT_ID} `,
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
        projectId: LEMMA_PROJECT_ID,
      },
    });
    expect(parseCommand(startArgv())).toMatchObject({
      options: {
        apiUrl: "https://api.uselemma.ai",
        openBrowser: true,
        projectId: undefined,
      },
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
          apiUrl: lemmaApiUrl("https://api.uselemma.ai", "--api-url"),
          org: "acme-inc-x1y2",
          projectId: LEMMA_PROJECT_ID,
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
      project_id: LEMMA_PROJECT_ID,
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
          "--project-id",
          " ",
        ),
      ),
    ).toMatchObject({
      options: {
        org: undefined,
        projectId: undefined,
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

  describe("--api-url", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const apiUrlOf = (value: string) => {
      const command = parseCommand(startArgv("--api-url", value));
      return command.kind === "start" ? command.options.apiUrl : null;
    };

    it.each([
      ["production", "https://api.uselemma.ai", "https://api.uselemma.ai"],
      ["dev", "https://dev.api.uselemma.ai/", "https://dev.api.uselemma.ai"],
      ["the bare domain", "https://uselemma.ai", "https://uselemma.ai"],
      [
        "a cased host",
        "HTTPS://Dev.API.uselemma.ai",
        "https://dev.api.uselemma.ai",
      ],
      ["localhost", "http://localhost:8000/", "http://localhost:8000"],
      ["localhost without a port", "http://localhost", "http://localhost"],
      ["127.0.0.1", "http://127.0.0.1:9", "http://127.0.0.1:9"],
      ["[::1]", "http://[::1]:8000", "http://[::1]:8000"],
      ["HTTPS on loopback", "https://localhost:8443", "https://localhost:8443"],
    ])("accepts %s", (_case, value, normalized) => {
      expect(apiUrlOf(value)).toBe(normalized);
    });

    it.each([
      ["a lookalike suffix", "https://uselemma.ai.evil.com"],
      ["a lookalike prefix", "https://eviluselemma.ai"],
      ["a trailing-dot host", "https://api.uselemma.ai."],
      ["plain HTTP off this machine", "http://api.uselemma.ai"],
      ["another host", "https://api.example.com"],
      ["userinfo naming Lemma", "https://uselemma.ai@evil.com"],
      ["credentials on a Lemma host", "https://user:pass@api.uselemma.ai"],
      ["a loopback lookalike", "http://localhost.evil.com"],
      ["another scheme", "ftp://localhost"],
    ])("refuses %s with exit 2, before any request", (_case, value) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      expect(usageErrorOf(startArgv("--api-url", value)).message).toContain(
        "--api-url must be a Lemma API: HTTPS on uselemma.ai or a subdomain, or HTTP/HTTPS on localhost, 127.0.0.1 or [::1]",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a value that is not a URL", () => {
      expect(
        usageErrorOf(startArgv("--api-url", "not a url")).message,
      ).toContain("--api-url is not a valid URL");
    });
  });

  it.each([
    ["a project name", "Support bot"],
    ["an ID without its dashes", "0b7c2f1e4d3a4f6b9c8d1a2b3c4d5e6f"],
    [
      "the name and ID from the prompt line",
      `Support bot (${LEMMA_PROJECT_ID})`,
    ],
  ])("refuses %s as --project-id with exit 2", (_case, value) => {
    expect(usageErrorOf(startArgv("--project-id", value)).message).toContain(
      "--project-id is the project's ID from the setup prompt",
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
