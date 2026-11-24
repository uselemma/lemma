import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import type { HarnessId } from "../harness.js";
import { notKept, OLD, place, plan, URL_ } from "../testing/mcp.js";
import { posix, temporaryDirectories } from "../testing/temp.js";
import { codexToml, mcpServersJson, openclawJson } from "./formats.js";
import {
  codexConfigPath,
  cursorConfigPath,
  hermesConfigPath,
  opencodeConfigPath,
  openclawConfigPath,
  piConfigPath,
} from "./paths.js";
import { keptMcpLine, manualMcpLines, plannedMcpNote } from "./targets.js";

const tempDir = temporaryDirectories("lemma-setup-mcp-");

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe("coding agents with a documented config file", () => {
  const cases: Array<{
    harness: HarnessId;
    path: (homeDir: string) => string;
    read: (contents: string) => unknown;
    entry: unknown;
  }> = [
    {
      harness: "cursor",
      path: (homeDir) => cursorConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcpServers.lemma,
      entry: { url: URL_ },
    },
    {
      harness: "pi",
      path: (homeDir) => piConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcpServers.lemma,
      entry: { url: URL_ },
    },
    {
      harness: "opencode",
      path: (homeDir) => opencodeConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcp.lemma,
      entry: { type: "remote", url: URL_, enabled: true },
    },
    {
      harness: "openclaw",
      path: (homeDir) => openclawConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcp.servers.lemma,
      entry: { url: URL_, transport: "streamable-http", auth: "oauth" },
    },
    {
      harness: "hermes",
      path: (homeDir) => hermesConfigPath({ homeDir, env: {} }),
      read: (contents) =>
        (parseYaml(contents) as { mcp_servers: { lemma: unknown } }).mcp_servers
          .lemma,
      entry: { url: URL_, auth: "oauth" },
    },
    {
      harness: "codex",
      path: (homeDir) => codexConfigPath({ homeDir, env: {} }),
      read: (contents) => contents,
      entry: `[mcp_servers.lemma]\nurl = "${URL_}"\n`,
    },
  ];

  it.each(cases)(
    "$harness: places a URL-only lemma server in its documented config, owner-only when new",
    async ({ harness, path, read, entry }) => {
      const home = await tempDir();
      const target = await plan(harness, home);
      expect(target).toMatchObject({ kind: "file", path: path(home) });
      const placement = await place(target);
      expect(placement).toEqual({
        placed: true,
        lines: [`MCP: added the \`lemma\` server in ${path(home)}.`],
      });
      expect(read(await readFile(path(home), "utf8"))).toEqual(entry);
      if (posix) expect(await mode(path(home))).toBe(0o600);
    },
  );

  it.each(cases)(
    "$harness: prints the lemma server in its own format for a config it cannot edit",
    async ({ harness, path, read, entry }) => {
      const home = await tempDir();
      await mkdir(path(home), { recursive: true });
      const target = notKept(await plan(harness, home));
      const reason = `${path(home)} is not a regular file, so setup does not edit it`;
      expect(target).toMatchObject({ kind: "manual", reason });
      const lines = manualMcpLines({ target, url: URL_, reason });
      expect(lines[0]).toBe(
        `MCP: ${reason}. Add this \`lemma\` server to ${target.codingAgentName}'s MCP servers:`,
      );
      expect(read(`${lines[1]}\n`)).toEqual(entry);
      expect(lines[2]).toMatch(
        /^Once it's added, to sign in to Lemma as yourself, run `\(cd \S+ && \S+ mcp (login|auth) lemma\)` in a terminal/,
      );
      expect(lines).toHaveLength(3);
    },
  );

  it("honors the agents' own config locations", async () => {
    const home = await tempDir();
    const env = {
      CODEX_HOME: join(home, "codex-home"),
      HERMES_HOME: join(home, "hermes-home"),
      OPENCODE_CONFIG_DIR: join(home, "opencode-dir"),
      OPENCLAW_CONFIG_PATH: join(home, "claw", "openclaw.json"),
    };
    expect(codexConfigPath({ homeDir: home, env })).toBe(
      join(home, "codex-home", "config.toml"),
    );
    expect(hermesConfigPath({ homeDir: home, env })).toBe(
      join(home, "hermes-home", "config.yaml"),
    );
    expect(opencodeConfigPath({ homeDir: home, env })).toBe(
      join(home, "opencode-dir", "opencode.json"),
    );
    expect(openclawConfigPath({ homeDir: home, env })).toBe(
      join(home, "claw", "openclaw.json"),
    );
    await expect(plan("codex", home, { env })).resolves.toMatchObject({
      path: join(home, "codex-home", "config.toml"),
    });
  });

  it("picks opencode.jsonc when it is the only OpenCode config", async () => {
    const home = await tempDir();
    const jsonc = join(home, ".config", "opencode", "opencode.jsonc");
    await mkdir(dirname(jsonc), { recursive: true });
    await writeFile(jsonc, '{ "mcp": {} }');
    expect(opencodeConfigPath({ homeDir: home, env: {} })).toBe(jsonc);
  });

  it.skipIf(!posix)(
    "replaces a lemma server that sends no key, keeping the file's mode and other servers",
    async () => {
      const home = await tempDir();
      const path = cursorConfigPath({ homeDir: home, env: {} });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          mcpServers: {
            github: { url: "https://gh" },
            lemma: { url: "https://dev.api.uselemma.ai/mcp/" },
          },
        }),
      );
      await chmod(path, 0o644);
      const target = await plan("cursor", home);
      expect(target.kind).toBe("file");
      expect(plannedMcpNote(target)).toBeNull();
      await expect(place(target)).resolves.toEqual({
        placed: true,
        lines: [`MCP: replaced the \`lemma\` server in ${path}.`],
      });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        mcpServers: { github: { url: "https://gh" }, lemma: { url: URL_ } },
      });
      expect(await mode(path)).toBe(0o644);
    },
  );

  it("reads a lemma server that sends an API key, and announces that setup leaves it", async () => {
    const home = await tempDir();
    const path = cursorConfigPath({ homeDir: home, env: {} });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          lemma: {
            url: "https://old",
            headers: { Authorization: `Bearer ${OLD}` },
          },
        },
      }),
    );
    const target = await plan("cursor", home);
    expect(target).toEqual({ kind: "kept", codingAgentName: "Cursor" });
    expect(plannedMcpNote(target)).toBe(
      "MCP: Cursor's `lemma` server sends an API key, so setup leaves it as it is.",
    );
    expect(keptMcpLine("Cursor")).not.toContain(OLD);
  });

  it("plans a manual add, with the reason, for a config it cannot read", async () => {
    const home = await tempDir();
    const path = openclawConfigPath({ homeDir: home, env: {} });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ gateway: { port: 18789 }, // JSON5\n}");
    await expect(plan("openclaw", home)).resolves.toMatchObject({
      kind: "manual",
      reason: `${path} is not plain JSON (setup cannot keep comments or trailing commas), so setup does not edit it`,
      codingAgentName: "OpenClaw",
      destination: { kind: "mcp-servers", format: openclawJson },
    });
  });

  it("plans a manual add for a Codex lemma server defined inline", async () => {
    const home = await tempDir();
    const path = codexConfigPath({ homeDir: home, env: {} });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '[mcp_servers]\nlemma = { url = "https://old" }\n');
    await expect(plan("codex", home)).resolves.toMatchObject({
      kind: "manual",
      reason: `${path} defines the \`lemma\` MCP server or \`mcp_servers\` in a form setup cannot edit (use a \`[mcp_servers.lemma]\` table), so setup does not edit it`,
      codingAgentName: "Codex",
      destination: { kind: "mcp-servers", format: codexToml },
    });
    expect(await readFile(path, "utf8")).toBe(
      '[mcp_servers]\nlemma = { url = "https://old" }\n',
    );
  });

  it.skipIf(!posix)(
    "plans a manual add for a symlink, and refuses one planted after planning with the same reason template",
    async () => {
      const home = await tempDir();
      const path = codexConfigPath({ homeDir: home, env: {} });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(join(home, "dotfiles.toml"), 'model = "gpt-5"\n');
      await symlink(join(home, "dotfiles.toml"), path);
      await expect(plan("codex", home)).resolves.toMatchObject({
        kind: "manual",
        reason: `${path} is a symlink, so setup does not edit it`,
      });

      const cursorPath = cursorConfigPath({ homeDir: home, env: {} });
      const target = await plan("cursor", home);
      await mkdir(dirname(cursorPath), { recursive: true });
      await symlink(join(home, "dotfiles.toml"), cursorPath);
      await expect(place(target)).resolves.toEqual({
        placed: false,
        reason: `${cursorPath} is a symlink, so setup does not edit it`,
      });
      expect(await readFile(join(home, "dotfiles.toml"), "utf8")).toBe(
        'model = "gpt-5"\n',
      );
    },
  );
});

describe("a coding agent without a documented config", () => {
  it("plans a manual add of the generic URL-only entry, announced before approval", async () => {
    const home = await tempDir();
    const target = notKept(await plan("other", home));
    const reason =
      "setup has no documented MCP config format for your coding agent";
    expect(target).toMatchObject({
      kind: "manual",
      reason,
      codingAgentName: "your coding agent",
      destination: { kind: "mcp-servers", format: mcpServersJson },
    });
    expect(plannedMcpNote(target)).toBe(
      `MCP: ${reason}. After approval, setup prints the \`lemma\` server for you to add to your coding agent's MCP servers.`,
    );
    const lines = manualMcpLines({ target, url: URL_, reason });
    expect(lines[0]).toBe(
      `MCP: ${reason}. Add this \`lemma\` server to your coding agent's MCP servers:`,
    );
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      mcpServers: { lemma: { url: URL_ } },
    });
  });
});
