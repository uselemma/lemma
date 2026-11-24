import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { RunCommand } from "../command.js";
import {
  notKept,
  OLD,
  place,
  plan,
  scriptedRun,
  URL_,
} from "../testing/mcp.js";
import { posix, temporaryDirectories } from "../testing/temp.js";
import { claudeConfigPath } from "./claude-code.js";
import { manualMcpLines, plannedMcpNote } from "./targets.js";

const tempDir = temporaryDirectories("lemma-setup-claude-");
const runsAsRoot = process.getuid?.() === 0;

describe("Claude Code's manual add", () => {
  const quote = (path: string) => `'${path.split("'").join("'\\''")}'`;
  const entry = { type: "http", url: URL_ };

  /** A manual Claude Code target for an app directory with a quote in its name. */
  async function manualClaudeTarget(home: string) {
    const appDir = join(home, "it's app");
    await mkdir(appDir);
    const { run } = scriptedRun({
      "--version": [{ code: null, stdout: "", stderr: "spawn claude ENOENT" }],
    });
    return {
      appDir,
      target: notKept(await plan("claude-code", home, { run, appDir })),
    };
  }

  it("prints the command setup runs, each path shell-quoted, then how to sign in", async () => {
    const home = await tempDir();
    const { appDir, target } = await manualClaudeTarget(home);
    const reason = "the `claude` command is not on PATH";
    expect(target).toMatchObject({ kind: "manual", reason });
    const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
    expect(manualMcpLines({ target, url: URL_, reason })).toEqual([
      `MCP: ${reason}.`,
      `Add the \`lemma\` server to Claude Code's local scope for ${appDir}, not the committed \`.mcp.json\`, with this command:`,
      `(cd ${quote(appDir)} && claude mcp add-json lemma ${quote(JSON.stringify(entry))} --scope local)`,
      `Or, with Claude Code closed, set \`projects[${JSON.stringify(appDir)}].mcpServers.lemma\` to ${JSON.stringify(entry)} in ${claudeJson}.`,
      `Once it's added, to sign in to Lemma as yourself, run \`(cd ${quote(appDir)} && claude mcp login lemma)\` in a terminal, or run /mcp in Claude Code, select \`lemma\`, and authenticate.`,
    ]);
  });

  /**
   * Runs a printed command from `home` against a stand-in `claude` that
   * records each call and refuses `remove`, as Claude Code does on an empty
   * local scope. PATH holds no other `claude`.
   */
  async function runPrinted(home: string, command: string) {
    const bin = join(home, "bin");
    const log = join(home, "calls");
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "claude"),
      [
        "#!/bin/sh",
        `printf '%s\\t%s\\t%s\\n' "$PWD" "$2" "$4" >> ${quote(log)}`,
        '[ "$2" = remove ] && exit 1',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const { stdout } = await promisify(execFile)(
      "/bin/sh",
      ["-c", `${command} && pwd`],
      { cwd: home, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } },
    );
    const calls = (await readFile(log, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => line.split("\t"));
    return { finishedIn: stdout.trim(), calls };
  }

  it.skipIf(!posix)(
    "its command adds the URL-only entry from the project root",
    async () => {
      const home = await tempDir();
      const { appDir, target } = await manualClaudeTarget(home);
      const command =
        manualMcpLines({ target, url: URL_, reason: "because" })[2] ?? "";
      const { finishedIn, calls } = await runPrinted(home, command);
      expect(await realpath(finishedIn)).toBe(await realpath(home));
      expect(calls).toHaveLength(1);
      const [cwd, subcommand, json] = calls[0] ?? [];
      expect(await realpath(cwd ?? "")).toBe(await realpath(appDir));
      expect(subcommand).toBe("add-json");
      expect(JSON.parse(json ?? "")).toEqual(entry);
    },
  );

  it.skipIf(!posix)(
    "its replacing command still adds when the entry is already gone, as after a failed restore",
    async () => {
      const home = await tempDir();
      await writeFile(
        claudeConfigPath({ homeDir: home, env: {} }),
        JSON.stringify({
          projects: {
            [home]: {
              mcpServers: { lemma: { type: "http", url: "https://old" } },
            },
          },
        }),
      );
      const { run } = scriptedRun({
        "--version": [
          { code: null, stdout: "", stderr: "spawn claude ENOENT" },
        ],
      });
      const target = notKept(await plan("claude-code", home, { run }));
      const command =
        manualMcpLines({ target, url: URL_, reason: "because" })[2] ?? "";
      const { calls } = await runPrinted(home, command);
      expect(calls.map(([, subcommand]) => subcommand)).toEqual([
        "remove",
        "add-json",
      ]);
      expect(JSON.parse(calls[1]?.[2] ?? "")).toEqual(entry);
    },
  );
});

describe("Claude Code", () => {
  const previousEntry = { type: "http", url: "https://old/mcp/" };

  async function claudeHome(
    entry: Record<string, unknown> | null,
  ): Promise<string> {
    const home = await tempDir();
    if (entry) {
      await writeFile(
        claudeConfigPath({ homeDir: home, env: {} }),
        JSON.stringify({
          projects: { [home]: { mcpServers: { lemma: entry } } },
        }),
      );
    }
    return home;
  }

  const addJsonArgv = (entry: unknown) => [
    "claude",
    "mcp",
    "add-json",
    "lemma",
    JSON.stringify(entry),
    "--scope",
    "local",
  ];
  const addArgv = addJsonArgv({ type: "http", url: URL_ });
  const removeArgv = ["claude", "mcp", "remove", "lemma", "--scope", "local"];

  it("without an existing entry, adds the server once from the git root", async () => {
    const home = await claudeHome(null);
    const { run, claudeCalls } = scriptedRun();
    const gitRun: RunCommand = async (command, args, cwd) =>
      command === "git"
        ? { code: 0, stdout: `${home}\n`, stderr: "" }
        : run(command, args, cwd);
    const target = await plan("claude-code", home, {
      run: gitRun,
      appDir: join(home, "apps", "web"),
    });
    expect(target).toMatchObject({
      kind: "claude-cli",
      destination: {
        kind: "claude-local-scope",
        projectRoot: home,
        previousEntry: null,
      },
    });
    await expect(place(target, run)).resolves.toEqual({
      placed: true,
      lines: [
        `MCP: added the \`lemma\` server in Claude Code for ${home} (local scope).`,
      ],
    });
    expect(claudeCalls()).toEqual([{ argv: addArgv, cwd: home }]);
  });

  it("without an existing entry, never removes anything when the add is refused", async () => {
    const home = await claudeHome(null);
    const { run, claudeCalls } = scriptedRun({
      "mcp add-json": [
        {
          code: 1,
          stdout: "",
          stderr: "MCP server lemma already exists in local config",
        },
      ],
    });
    const placement = await place(
      await plan("claude-code", home, { run }),
      run,
    );
    expect(claudeCalls().map((call) => call.argv)).toEqual([addArgv]);
    expect(placement).toEqual({
      placed: false,
      reason:
        "Claude Code did not add the Lemma MCP server (MCP server lemma already exists in local config)",
    });
  });

  it("reads a local lemma server that sends an API key, and announces that setup leaves it", async () => {
    const home = await claudeHome({
      ...previousEntry,
      headers: { Authorization: `Bearer ${OLD}` },
    });
    const target = await plan("claude-code", home);
    expect(target).toEqual({ kind: "kept", codingAgentName: "Claude Code" });
    expect(plannedMcpNote(target)).toBe(
      "MCP: Claude Code's `lemma` server sends an API key, so setup leaves it as it is.",
    );
  });

  it("with an existing entry that sends no key, removes it, and adds the new one", async () => {
    const home = await claudeHome(previousEntry);
    const { run, claudeCalls } = scriptedRun();
    const target = await plan("claude-code", home, { run });
    expect(target).toMatchObject({
      kind: "claude-cli",
      destination: { previousEntry },
    });
    const placement = await place(target, run);
    expect(claudeCalls().map((call) => call.argv)).toEqual([
      removeArgv,
      addArgv,
    ]);
    expect(placement.placed && placement.lines[0]).toContain(
      "replaced the `lemma` server",
    );
  });

  it("with an existing entry, stops without adding or restoring when the removal fails", async () => {
    const home = await claudeHome(previousEntry);
    const { run, claudeCalls } = scriptedRun({
      "mcp remove": [{ code: 1, stdout: "", stderr: "permission denied" }],
    });
    const placement = await place(
      await plan("claude-code", home, { run }),
      run,
    );
    expect(claudeCalls().map((call) => call.argv)).toEqual([removeArgv]);
    expect(placement).toEqual({
      placed: false,
      reason:
        "Claude Code did not remove its existing `lemma` server, so that server is unchanged (permission denied)",
    });
  });

  it("with an existing entry, restores it after a failed add", async () => {
    const home = await claudeHome(previousEntry);
    const { run, claudeCalls } = scriptedRun({
      "mcp add-json": [{ code: 1, stdout: "", stderr: "invalid entry" }],
    });
    const placement = await place(
      await plan("claude-code", home, { run }),
      run,
    );
    expect(claudeCalls()).toEqual([
      { argv: removeArgv, cwd: home },
      { argv: addArgv, cwd: home },
      { argv: addJsonArgv(previousEntry), cwd: home },
    ]);
    expect(placement).toEqual({
      placed: false,
      reason:
        "Claude Code did not accept the new Lemma MCP server (invalid entry); setup restored the previous `lemma` server",
    });
  });

  it("says so when the previous entry cannot be restored either, and prints the replacing command", async () => {
    const home = await claudeHome(previousEntry);
    const { run } = scriptedRun({
      "mcp add-json": [
        { code: 1, stdout: "", stderr: "refused" },
        { code: 1, stdout: "", stderr: "refused" },
      ],
    });
    const target = notKept(await plan("claude-code", home, { run }));
    const placement = await place(target, run);
    if (placement.placed) throw new Error("expected the add to fail");
    expect(placement.reason).toContain(
      "setup could not restore the previous `lemma` server",
    );
    // The scope is now empty, so the printed removal finds nothing and is ignored.
    expect(
      manualMcpLines({ target, url: URL_, reason: placement.reason })[2],
    ).toBe(
      `(cd ${home} && { claude mcp remove lemma --scope local >/dev/null 2>&1; claude mcp add-json lemma '${JSON.stringify({ type: "http", url: URL_ })}' --scope local; })`,
    );
  });

  it("with an entry that sends no key, prints a command that removes it, if it is still there, before adding", async () => {
    const home = await claudeHome(previousEntry);
    const target = notKept(await plan("claude-code", home));
    const lines = manualMcpLines({ target, url: URL_, reason: "because" });
    expect(lines.slice(1, 3)).toEqual([
      `Replace any \`lemma\` server in Claude Code's local scope for ${home}, not the committed \`.mcp.json\`, with this command:`,
      `(cd ${home} && { claude mcp remove lemma --scope local >/dev/null 2>&1; claude mcp add-json lemma '${JSON.stringify({ type: "http", url: URL_ })}' --scope local; })`,
    ]);
  });

  it.each([
    ["a key header", { headers: { Authorization: `Bearer ${OLD}` } }],
    ["a headers helper", { headersHelper: "/usr/local/bin/lemma-headers" }],
  ])(
    "keeps a local lemma server that sends %s, even without the claude command",
    async (_case, credential) => {
      const home = await claudeHome({ ...previousEntry, ...credential });
      const { run } = scriptedRun({
        "--version": [
          { code: null, stdout: "", stderr: "spawn claude ENOENT" },
        ],
      });
      await expect(plan("claude-code", home, { run })).resolves.toEqual({
        kind: "kept",
        codingAgentName: "Claude Code",
      });
    },
  );

  it("honors CLAUDE_CONFIG_DIR", async () => {
    const home = await tempDir();
    expect(
      claudeConfigPath({
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: join(home, "cc") },
      }),
    ).toBe(join(home, "cc", ".claude.json"));
  });

  it("plans a manual add for a Claude Code config that is not valid JSON", async () => {
    const home = await tempDir();
    const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
    await writeFile(claudeJson, "{ not json");
    await expect(plan("claude-code", home)).resolves.toMatchObject({
      kind: "manual",
      reason: `${claudeJson} is not valid JSON, so setup cannot read Claude Code's existing \`lemma\` server`,
      destination: { kind: "claude-local-scope", projectRoot: home },
    });
  });

  it.skipIf(!posix || runsAsRoot)(
    "fails planning for a Claude Code config it cannot read",
    async () => {
      const home = await claudeHome(previousEntry);
      const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
      await chmod(claudeJson, 0o000);
      const planned = plan("claude-code", home);
      await expect(planned).rejects.toThrow(/EACCES/);
      await chmod(claudeJson, 0o600);
    },
  );

  it("plans a manual add when the claude CLI is missing, for the project's local scope", async () => {
    const home = await tempDir();
    const { run } = scriptedRun({
      "--version": [{ code: null, stdout: "", stderr: "spawn claude ENOENT" }],
    });
    const destination = {
      kind: "claude-local-scope",
      projectRoot: home,
      claudeConfig: claudeConfigPath({ homeDir: home, env: {} }),
      previousEntry: null,
    };
    await expect(plan("claude-code", home, { run })).resolves.toMatchObject({
      kind: "manual",
      reason: "the `claude` command is not on PATH",
      codingAgentName: "Claude Code",
      destination,
    });
    // A refused add later prints the same destination.
    await expect(plan("claude-code", home)).resolves.toMatchObject({
      kind: "claude-cli",
      destination,
    });
  });

  it("catches a command that throws, at the one catch site", async () => {
    const home = await claudeHome(null);
    const target = await plan("claude-code", home);
    const throwing: RunCommand = async () => {
      throw Object.assign(new Error("spawn EAGAIN"), { syscall: "spawn" });
    };
    await expect(place(target, throwing)).resolves.toEqual({
      placed: false,
      reason: "setup could not place the Lemma MCP server (spawn EAGAIN)",
    });
  });
});
