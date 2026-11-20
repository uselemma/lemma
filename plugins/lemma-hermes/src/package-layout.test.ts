import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(".");

describe("Hermes package layout", () => {
  it("ships the native plugin, runtime, and setup command", async () => {
    await Promise.all(
      [
        "hermes-plugin/lemma/__init__.py",
        "hermes-plugin/lemma/plugin.yaml",
        "hermes-plugin/lemma/runtime/flush.mjs",
        "scripts/setup.mjs",
      ].map((path) => access(resolve(pluginRoot, path))),
    );
    const manifest = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "@uselemma/hermes",
      bin: { "lemma-hermes": "./scripts/setup.mjs" },
    });
    expect(manifest).not.toHaveProperty("private", true);
  });

  it("pins the Hermes plugin manifest version to package.json", async () => {
    const [manifest, packageJson] = await Promise.all([
      readFile(resolve(pluginRoot, "hermes-plugin/lemma/plugin.yaml"), "utf8"),
      readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ]);
    expect(manifest.match(/^version: "([^"]+)"$/m)?.[1]).toBe(
      (JSON.parse(packageJson) as { version: string }).version,
    );
  });
});
