import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(pluginRoot, "..", "..");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("Codex plugin layout", () => {
  it("declares hooks for the complete turn lifecycle without SessionEnd", async () => {
    const config = await json(resolve(pluginRoot, "hooks", "hooks.json"));
    const hooks = config.hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      "PostToolUse",
      "PreToolUse",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(hooks).not.toHaveProperty("SessionEnd");
    expect(JSON.stringify(config)).toContain("${PLUGIN_ROOT}/runtime/hook.mjs");
    await expect(
      readFile(resolve(pluginRoot, "runtime", "flush.mjs"), "utf8"),
    ).resolves.toContain("flushPendingTurns");
  });

  it("has no MCP dependency and installs only from the checkout-local marketplace", async () => {
    const manifest = await json(
      resolve(pluginRoot, ".codex-plugin", "plugin.json"),
    );
    expect(manifest).not.toHaveProperty("mcpServers");
    expect(manifest).not.toHaveProperty("hooks");

    const marketplace = await json(
      resolve(repositoryRoot, ".agents", "plugins", "marketplace.json"),
    );
    expect(marketplace).toMatchObject({
      name: "lemma-local",
      plugins: [
        {
          name: "lemma-codex",
          source: {
            source: "local",
            path: "./plugins/lemma-codex",
          },
        },
      ],
    });
  });
});
