import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { RunCommand } from "../command.js";
import {
  KEY,
  OLD,
  place,
  plan,
  saved,
  scriptedRun,
  URL_,
} from "../testing/mcp.js";
import { posix, temporaryDirectories } from "../testing/temp.js";
import { claudeConfigPath } from "./claude-code.js";
import { saveMcpEntryPrivately, type McpTarget } from "./targets.js";

const tempDir = temporaryDirectories("lemma-setup-claude-");
const runsAsRoot = process.getuid?.() === 0;

describe("Claude Code's private MCP file", () => {
  const quote = (path: string) => `'${path.split("'").join("'\\''")}'`;
  const entryWith = (apiKey: string) => ({
    type: "http",
    url: URL_,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  /** A private Claude Code target for an app directory with a quote in its name. */
  async function privateClaudeTarget(home: string) {
    const appDir = join(home, "it's app");
    await mkdir(appDir);
    const { run } = scriptedRun({
      "--version": [{ code: null, stdout: "", stderr: "spawn claude ENOENT" }],
    });
    return { appDir, target: await plan("claude-code", home, { run, appDir }) };
  }

  function save(target: McpTarget, apiKey: string) {
    return saveMcpEntryPrivately({
      target,
      url: URL_,
      apiKey,
      reason: "the `claude` command is not on PATH",
    });
  }

  it("holds the bare entry and prints a replacing command that reads it, with each path shell-quoted", async () => {
    const home = await tempDir();
    const { appDir, target } = await privateClaudeTarget(home);
    const result = await save(target, KEY);
    expect(result.saved).toBe(true);
    expect(JSON.parse(await readFile(target.fallbackPath, "utf8"))).toEqual(
      entryWith(KEY),
    );
    const file = quote(target.fallbackPath);
    const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
    expect(result.lines.slice(0, 5)).toEqual([
      `MCP: the \`claude\` command is not on PATH. The full entry, key included, is in ${target.fallbackPath} (readable only by you).`,
      `Add it to Claude Code's local scope for ${appDir}, not the committed \`.mcp.json\`, with this command. It replaces any \`lemma\` server there, deletes that file once the new one is added, and changes nothing once that file is gone:`,
      `(cd ${quote(appDir)} && entry="$(cat ${file})" && { claude mcp remove lemma --scope local >/dev/null 2>&1; claude mcp add-json lemma "$entry" --scope local; } && rm ${file})`,
      `Or, with Claude Code closed, add it as \`projects[${JSON.stringify(appDir)}].mcpServers.lemma\` in ${claudeJson}, then delete that file.`,
      "The entry has this shape:",
    ]);
    expect(result.lines.join("\n")).toContain('"type": "http"');
    expect(result.lines.join("\n")).not.toContain(KEY);
  });

  it.skipIf(!posix)(
    "its command adds a fresh entry, changes nothing on a rerun, replaces an existing entry, and deletes the file only after an add",
    async () => {
      const home = await tempDir();
      const { appDir, target } = await privateClaudeTarget(home);
      const command = (await save(target, KEY)).lines[2] ?? "";
      const bin = join(home, "bin");
      const local = join(home, "local-lemma.json");
      const log = join(home, "calls");
      await mkdir(bin);
      // Keeps one local `lemma` entry and refuses what Claude Code refuses.
      await writeFile(
        join(bin, "claude"),
        [
          "#!/bin/sh",
          `printf '%s\\t%s\\n' "$PWD" "$2" >> ${quote(log)}`,
          'case "$2" in',
          `  remove) [ -f ${quote(local)} ] || exit 1; rm ${quote(local)} ;;`,
          `  add-json) [ -z "$REFUSE_ADD" ] && [ ! -f ${quote(local)} ] || exit 1`,
          `    node -e 'JSON.parse(process.argv[1])' "$4" 2>/dev/null || exit 1`,
          `    printf '%s' "$4" > ${quote(local)} ;;`,
          "esac",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const runCommand = (env: Record<string, string> = {}) =>
        promisify(execFile)("/bin/sh", ["-c", `${command} && pwd`], {
          cwd: home,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
        });

      const fresh = await runCommand();
      expect(await realpath(fresh.stdout.trim())).toBe(await realpath(home));
      expect(JSON.parse(await readFile(local, "utf8"))).toEqual(entryWith(KEY));
      await expect(stat(target.fallbackPath)).rejects.toThrow();

      // A rerun, from shell history or a retry, finds no file and leaves the server alone.
      await expect(runCommand()).rejects.toThrow();
      expect(JSON.parse(await readFile(local, "utf8"))).toEqual(entryWith(KEY));

      await save(target, OLD);
      await runCommand();
      expect(JSON.parse(await readFile(local, "utf8"))).toEqual(entryWith(OLD));
      await expect(stat(target.fallbackPath)).rejects.toThrow();

      await save(target, KEY);
      await expect(runCommand({ REFUSE_ADD: "1" })).rejects.toThrow();
      await expect(readFile(target.fallbackPath, "utf8")).resolves.toContain(
        KEY,
      );

      const calls = (await readFile(log, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => line.split("\t"));
      expect(calls.map(([, subcommand]) => subcommand)).toEqual([
        "remove",
        "add-json",
        "remove",
        "add-json",
        "remove",
        "add-json",
      ]);
      for (const [cwd] of calls) {
        expect(await realpath(cwd ?? "")).toBe(await realpath(appDir));
      }
    },
  );
});

describe("Claude Code", () => {
  const previousEntry = {
    type: "http",
    url: "https://old/mcp/",
    headers: { Authorization: `Bearer ${OLD}` },
  };

  async function claudeHome(withEntry: boolean): Promise<string> {
    const home = await tempDir();
    if (withEntry) {
      await writeFile(
        claudeConfigPath({ homeDir: home, env: {} }),
        JSON.stringify({
          projects: { [home]: { mcpServers: { lemma: previousEntry } } },
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
  const addArgv = addJsonArgv({
    type: "http",
    url: URL_,
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const removeArgv = ["claude", "mcp", "remove", "lemma", "--scope", "local"];

  it("without an existing entry, adds the server once from the git root", async () => {
    const home = await claudeHome(false);
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
      destination: { kind: "claude-local-scope", projectRoot: home },
      previousEntry: null,
    });
    expect(target.existing).toEqual({ kind: "none" });
    await expect(place(target, run)).resolves.toEqual({
      placed: true,
      lines: [
        `MCP: added the \`lemma\` server in Claude Code for ${home} (local scope).`,
        "MCP: restart Claude Code, or reconnect it with /mcp, to load the Lemma tools.",
      ],
    });
    expect(claudeCalls()).toEqual([{ argv: addArgv, cwd: home }]);
  });

  it("without an existing entry, never removes anything when the add is refused", async () => {
    const home = await claudeHome(false);
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

  it("with an existing entry, reads its key, removes it, and adds the new one", async () => {
    const home = await claudeHome(true);
    const { run, claudeCalls } = scriptedRun();
    const target = await plan("claude-code", home, { run });
    expect(target).toMatchObject({ previousEntry });
    expect(target.existing).toEqual({ kind: "key", key: OLD });
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
    const home = await claudeHome(true);
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
    const home = await claudeHome(true);
    const { run, claudeCalls } = scriptedRun({
      "mcp add-json": [
        {
          code: 1,
          stdout: "",
          stderr: `invalid header Authorization: Bearer ${KEY}`,
        },
      ],
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
    expect(placement.placed).toBe(false);
    const reason = !placement.placed ? (placement.reason ?? "") : "";
    expect(reason).toContain("setup restored the previous `lemma` server");
    expect(reason).toContain("[redacted]");
    expect(reason).not.toContain(KEY);
    expect(reason).not.toContain(OLD);
  });

  it("says so when the previous entry cannot be restored either", async () => {
    const home = await claudeHome(true);
    const { run } = scriptedRun({
      "mcp add-json": [
        { code: 1, stdout: "", stderr: "refused" },
        { code: 1, stdout: "", stderr: "refused" },
      ],
    });
    const placement = await place(
      await plan("claude-code", home, { run }),
      run,
    );
    expect(!placement.placed && placement.reason).toContain(
      "setup could not restore the previous `lemma` server",
    );
  });

  it("honors CLAUDE_CONFIG_DIR", async () => {
    const home = await tempDir();
    expect(
      claudeConfigPath({
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: join(home, "cc") },
      }),
    ).toBe(join(home, "cc", ".claude.json"));
  });

  it("plans the private file for a Claude Code config that is not valid JSON", async () => {
    const home = await tempDir();
    const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
    await writeFile(claudeJson, "{ not json");
    await expect(plan("claude-code", home)).resolves.toMatchObject({
      kind: "private",
      reason: `${claudeJson} is not valid JSON, so setup cannot read Claude Code's existing \`lemma\` server`,
      destination: { kind: "claude-local-scope", projectRoot: home },
    });
  });

  it.skipIf(!posix || runsAsRoot)(
    "fails planning for a Claude Code config it cannot read",
    async () => {
      const home = await claudeHome(true);
      const claudeJson = claudeConfigPath({ homeDir: home, env: {} });
      await chmod(claudeJson, 0o000);
      const planned = plan("claude-code", home);
      await expect(planned).rejects.toThrow(/EACCES/);
      await chmod(claudeJson, 0o600);
    },
  );

  it("plans the private file when the claude CLI is missing, for the project's local scope", async () => {
    const home = await tempDir();
    const { run } = scriptedRun({
      "--version": [{ code: null, stdout: "", stderr: "spawn claude ENOENT" }],
    });
    const destination = {
      kind: "claude-local-scope",
      projectRoot: home,
      claudeConfig: claudeConfigPath({ homeDir: home, env: {} }),
    };
    await expect(plan("claude-code", home, { run })).resolves.toMatchObject({
      kind: "private",
      reason: "the `claude` command is not on PATH",
      codingAgentName: "Claude Code",
      existing: { kind: "none" },
      fallbackPath: saved(home, "claude-code", "json"),
      destination,
    });
    // A refused add later falls back to the same file and destination.
    await expect(plan("claude-code", home)).resolves.toMatchObject({
      kind: "claude-cli",
      destination,
    });
  });

  it("catches a command that throws, at the one catch site", async () => {
    const home = await claudeHome(false);
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
