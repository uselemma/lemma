import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("Cursor plugin layout", () => {
  it("registers one complete prompt lifecycle", async () => {
    const config = await json(resolve(pluginRoot, "hooks", "hooks.json"));
    const hooks = config.hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([
      "afterAgentResponse",
      "beforeSubmitPrompt",
      "postToolUse",
      "postToolUseFailure",
      "preToolUse",
      "sessionEnd",
      "stop",
    ]);
    expect(JSON.stringify(config)).toContain(
      "${CURSOR_PLUGIN_ROOT}/runtime/hook.mjs",
    );
  });

  it("ships hooks only, without MCP, skills, or rules", async () => {
    const manifest = await json(
      resolve(pluginRoot, ".cursor-plugin", "plugin.json"),
    );
    expect(manifest).toMatchObject({
      name: "lemma-cursor",
      hooks: "./hooks/hooks.json",
    });
    expect(manifest).not.toHaveProperty("mcpServers");
    await expect(access(resolve(pluginRoot, "mcp.json"))).rejects.toThrow();
    await expect(access(resolve(pluginRoot, "skills"))).rejects.toThrow();
    await expect(access(resolve(pluginRoot, "rules"))).rejects.toThrow();
  });
});
