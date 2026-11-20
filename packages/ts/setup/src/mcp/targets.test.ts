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
import { KEY, OLD, place, plan, saved, URL_ } from "../testing/mcp.js";
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
import { saveMcpEntryPrivately } from "./targets.js";

const tempDir = temporaryDirectories("lemma-setup-mcp-");

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe("coding agents with a documented config file", () => {
  const cases: Array<{
    harness: HarnessId;
    extension: string;
    path: (homeDir: string) => string;
    read: (contents: string) => unknown;
    entry: unknown;
  }> = [
    {
      harness: "cursor",
      extension: "json",
      path: (homeDir) => cursorConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcpServers.lemma,
      entry: { url: URL_, headers: { Authorization: `Bearer ${KEY}` } },
    },
    {
      harness: "pi",
      extension: "json",
      path: (homeDir) => piConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcpServers.lemma,
      entry: { url: URL_, headers: { Authorization: `Bearer ${KEY}` } },
    },
    {
      harness: "opencode",
      extension: "json",
      path: (homeDir) => opencodeConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcp.lemma,
      entry: {
        type: "remote",
        url: URL_,
        headers: { Authorization: `Bearer ${KEY}` },
        oauth: false,
        enabled: true,
      },
    },
    {
      harness: "openclaw",
      extension: "json",
      path: (homeDir) => openclawConfigPath({ homeDir, env: {} }),
      read: (contents) => JSON.parse(contents).mcp.servers.lemma,
      entry: {
        url: URL_,
        transport: "streamable-http",
        headers: { Authorization: `Bearer ${KEY}` },
      },
    },
    {
      harness: "hermes",
      extension: "yaml",
      path: (homeDir) => hermesConfigPath({ homeDir, env: {} }),
      read: (contents) =>
        (parseYaml(contents) as { mcp_servers: { lemma: unknown } }).mcp_servers
          .lemma,
      entry: { url: URL_, headers: { Authorization: `Bearer ${KEY}` } },
    },
    {
      harness: "codex",
      extension: "toml",
      path: (homeDir) => codexConfigPath({ homeDir, env: {} }),
      read: (contents) => contents,
      entry: `[mcp_servers.lemma]\nurl = "${URL_}"\nhttp_headers = { Authorization = "Bearer ${KEY}" }\n`,
    },
  ];

  it.each(cases)(
    "$harness: places the key in its documented config, owner-only when new, never printing the key",
    async ({ harness, path, read, entry }) => {
      const home = await tempDir();
      const target = await plan(harness, home);
      expect(target).toMatchObject({ kind: "file", path: path(home) });
      expect(target.existing).toEqual({ kind: "none" });
      const placement = await place(target);
      expect(placement.placed).toBe(true);
      expect(read(await readFile(path(home), "utf8"))).toEqual(entry);
      if (posix) expect(await mode(path(home))).toBe(0o600);
      if (placement.placed) {
        expect(placement.lines[0]).toContain("added the `lemma` server");
        expect(placement.lines.join("\n")).not.toContain(KEY);
      }
    },
  );

  it.each(cases)(
    "$harness: saves the private entry in its own format, ready to paste",
    async ({ harness, extension, path, read, entry }) => {
      const home = await tempDir();
      await mkdir(path(home), { recursive: true });
      const target = await plan(harness, home);
      expect(target).toMatchObject({
        kind: "private",
        reason: `${path(home)} is not a regular file, so setup does not edit it`,
      });
      expect(target.fallbackPath.endsWith(`-${harness}-mcp.${extension}`)).toBe(
        true,
      );

      const result = await saveMcpEntryPrivately({
        target,
        url: URL_,
        apiKey: KEY,
        reason: "because",
      });
      expect(result.saved).toBe(true);
      expect(read(await readFile(target.fallbackPath, "utf8"))).toEqual(entry);
      if (posix) expect(await mode(target.fallbackPath)).toBe(0o600);
      const printed = result.lines.join("\n");
      expect(printed).toContain("lemma_admin_key_from_the_file_above");
      expect(printed).not.toContain(KEY);
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
    "reads the existing key, keeps the file's mode, and warns once when others can read it",
    async () => {
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
      await chmod(path, 0o644);
      const target = await plan("cursor", home);
      expect(target.existing).toEqual({ kind: "key", key: OLD });
      const placement = await place(target);
      expect(placement).toEqual({
        placed: true,
        lines: [
          `MCP: replaced the \`lemma\` server in ${path}.`,
          `Warning: other users on this machine can read ${path} (mode 644), which holds the admin key. Run \`chmod 600 ${path}\` to keep it private.`,
          "MCP: reload MCP servers in Cursor Settings to load the Lemma tools.",
        ],
      });
      expect(await mode(path)).toBe(0o644);
    },
  );

  it("plans the private file, with the reason, for a config it cannot read", async () => {
    const home = await tempDir();
    const path = openclawConfigPath({ homeDir: home, env: {} });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ gateway: { port: 18789 }, // JSON5\n}");
    await expect(plan("openclaw", home)).resolves.toMatchObject({
      kind: "private",
      reason: `${path} is not plain JSON (setup cannot keep comments or trailing commas), so setup does not edit it`,
      codingAgentName: "OpenClaw",
      existing: { kind: "none" },
      fallbackPath: saved(home, "openclaw", "json"),
      destination: { kind: "mcp-servers", format: openclawJson },
    });
  });

  it("plans the private file for a Codex lemma server defined inline", async () => {
    const home = await tempDir();
    const path = codexConfigPath({ homeDir: home, env: {} });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '[mcp_servers]\nlemma = { url = "https://old" }\n');
    await expect(plan("codex", home)).resolves.toMatchObject({
      kind: "private",
      reason: `${path} defines the \`lemma\` MCP server or \`mcp_servers\` in a form setup cannot edit (use a \`[mcp_servers.lemma]\` table), so setup does not edit it`,
      codingAgentName: "Codex",
      existing: { kind: "none" },
      fallbackPath: saved(home, "codex", "toml"),
      destination: { kind: "mcp-servers", format: codexToml },
    });
    expect(await readFile(path, "utf8")).toBe(
      '[mcp_servers]\nlemma = { url = "https://old" }\n',
    );
  });

  it.skipIf(!posix)(
    "plans the private file for a symlink, and refuses one planted after planning with the same reason template",
    async () => {
      const home = await tempDir();
      const path = codexConfigPath({ homeDir: home, env: {} });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(join(home, "dotfiles.toml"), 'model = "gpt-5"\n');
      await symlink(join(home, "dotfiles.toml"), path);
      await expect(plan("codex", home)).resolves.toMatchObject({
        kind: "private",
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

describe("the private MCP file", () => {
  it("holds the generic entry with the key, prints its shape without it, and is keyed by app", async () => {
    const home = await tempDir();
    const first = await plan("other", home, { appDir: join(home, "app-one") });
    const second = await plan("other", home, { appDir: join(home, "app-two") });
    expect(first).toMatchObject({
      kind: "private",
      reason: "setup has no documented MCP config format for your coding agent",
      codingAgentName: "your coding agent",
      existing: { kind: "none" },
      fallbackPath: saved(home, "other", "json", join(home, "app-one")),
      destination: { kind: "mcp-servers", format: mcpServersJson },
    });
    expect(first.fallbackPath).not.toBe(second.fallbackPath);

    const result = await saveMcpEntryPrivately({
      target: first,
      url: URL_,
      apiKey: KEY,
      reason: "setup has no documented MCP config format for your coding agent",
    });
    await saveMcpEntryPrivately({
      target: second,
      url: URL_,
      apiKey: OLD,
      reason: "because",
    });
    expect(JSON.parse(await readFile(first.fallbackPath, "utf8"))).toEqual({
      mcpServers: {
        lemma: { url: URL_, headers: { Authorization: `Bearer ${KEY}` } },
      },
    });
    await expect(readFile(second.fallbackPath, "utf8")).resolves.toContain(OLD);
    if (posix) expect(await mode(first.fallbackPath)).toBe(0o600);
    expect(result.saved).toBe(true);
    const printed = result.lines.join("\n");
    expect(result.lines.slice(0, 3)).toEqual([
      `MCP: setup has no documented MCP config format for your coding agent. The full entry, key included, is in ${first.fallbackPath} (readable only by you).`,
      "Add it to your coding agent's MCP servers, then delete that file.",
      "The entry has this shape:",
    ]);
    expect(printed).toContain(
      '"Authorization": "Bearer lemma_admin_key_from_the_file_above"',
    );
    expect(printed).not.toContain(KEY);
  });

  it("reports when the key cannot be saved either", async () => {
    const home = await tempDir();
    await writeFile(join(home, "blocker"), "");
    const result = await saveMcpEntryPrivately({
      target: {
        kind: "private",
        reason: "because",
        codingAgentName: "your coding agent",
        existing: { kind: "none" },
        fallbackPath: join(home, "blocker", "entry.json"),
        destination: { kind: "mcp-servers", format: mcpServersJson },
      },
      url: URL_,
      apiKey: KEY,
      reason: "because",
    });
    expect(result.saved).toBe(false);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(
      /^MCP: because, and setup could not save the admin key \(.+\)\. Run `start` again\.$/,
    );
  });
});
