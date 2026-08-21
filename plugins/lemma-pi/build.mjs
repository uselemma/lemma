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
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    external: ["@earendil-works/pi-telemetry", "@uselemma/tracing"],
  }),
  build({
    ...shared,
    entryPoints: ["src/extension-entry.ts"],
    outfile: "extensions/lemma.mjs",
    external: ["@earendil-works/pi-coding-agent", "@uselemma/tracing"],
  }),
  build({
    ...shared,
    entryPoints: ["src/setup-entry.ts"],
    outfile: "scripts/setup.mjs",
    banner: { js: "#!/usr/bin/env node" },
  }),
]);

await chmod("scripts/setup.mjs", 0o755);
