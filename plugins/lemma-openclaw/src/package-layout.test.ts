import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(".");

describe("OpenClaw package layout", () => {
  it("ships the native plugin, delivery runtime, and setup command", async () => {
    await Promise.all(
      [
        "dist/index.js",
        "runtime/flush.mjs",
        "scripts/setup.mjs",
        "openclaw.plugin.json",
        "README.md",
      ].map((path) => access(resolve(pluginRoot, path))),
    );
    const manifest = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "@uselemma/openclaw",
      bin: { "lemma-openclaw": "./scripts/setup.mjs" },
    });
    expect(manifest).not.toHaveProperty("private", true);
  });
});
