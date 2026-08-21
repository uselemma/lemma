import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("OpenCode package layout", () => {
  it("ships self-contained plugin and setup bundles", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      name: string;
      bin: Record<string, string>;
      types: string;
      files: string[];
    };
    expect(packageJson).toMatchObject({
      name: "@uselemma/opencode",
      bin: { "lemma-opencode": "./scripts/setup.mjs" },
      types: "./runtime/lemma.d.ts",
    });
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "runtime/lemma.mjs",
        "runtime/lemma.d.ts",
        "scripts/setup.mjs",
        "README.md",
      ]),
    );
    await Promise.all([
      access(new URL("../build.mjs", import.meta.url)),
      access(new URL("../README.md", import.meta.url)),
    ]);
  });
});
