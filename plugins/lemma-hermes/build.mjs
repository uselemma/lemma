import { chmod } from "node:fs/promises";

import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/flush-entry.ts"],
    outfile: "hermes-plugin/lemma/runtime/flush.mjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/setup-entry.ts"],
    outfile: "scripts/setup.mjs",
    banner: { js: "#!/usr/bin/env node" },
  }),
]);

await chmod("scripts/setup.mjs", 0o755);
