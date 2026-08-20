import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(pluginRoot, "..", "..");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("Claude Code plugin layout", () => {
  it("registers the native lifecycle needed for one trace per prompt", async () => {
    const config = await json(resolve(pluginRoot, "hooks", "hooks.json"));
    const hooks = config.hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(JSON.stringify(config)).toContain(
      "${CLAUDE_PLUGIN_ROOT}/runtime/hook.mjs",
    );
  });

  it("ships through a Claude marketplace without MCP or skills", async () => {
    const manifest = await json(
      resolve(pluginRoot, ".claude-plugin", "plugin.json"),
    );
    expect(manifest).toMatchObject({ name: "lemma-claude-code" });
    expect(manifest).not.toHaveProperty("mcpServers");

    const marketplace = await json(
      resolve(repositoryRoot, ".claude-plugin", "marketplace.json"),
    );
    expect(marketplace).toMatchObject({
      name: "lemma-local",
      plugins: [
        {
          name: "lemma-claude-code",
          source: "./plugins/lemma-claude-code",
        },
      ],
    });
    await expect(access(resolve(pluginRoot, ".mcp.json"))).rejects.toThrow();
    await expect(access(resolve(pluginRoot, "skills"))).rejects.toThrow();
  });
});
