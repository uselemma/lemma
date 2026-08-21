import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/hook-entry.ts"],
    outfile: "runtime/hook.mjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/flush-entry.ts"],
    outfile: "runtime/flush.mjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/setup-entry.ts"],
    outfile: "scripts/setup.mjs",
  }),
]);
