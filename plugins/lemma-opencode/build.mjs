import { chmod, mkdir, rm, writeFile } from "node:fs/promises";

import { build } from "esbuild";

await rm("runtime", { recursive: true, force: true });
await rm("scripts", { recursive: true, force: true });
await mkdir("runtime", { recursive: true });
await mkdir("scripts", { recursive: true });

await build({
  entryPoints: ["src/plugin-entry.ts"],
  outfile: "runtime/lemma.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  banner: { js: "// @uselemma/opencode managed plugin" },
});

await writeFile(
  "runtime/lemma.d.ts",
  'import type { Plugin } from "@opencode-ai/plugin";\n\nexport declare const LemmaPlugin: Plugin;\n',
);

await build({
  entryPoints: ["src/setup-entry.ts"],
  outfile: "scripts/setup.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
});

await chmod("scripts/setup.mjs", 0o755);
