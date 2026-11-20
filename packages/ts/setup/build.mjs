import { chmod, mkdir, rm } from "node:fs/promises";

import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  minify: false,
  // Bundled CommonJS dependencies (the YAML parser) call `require` for Node
  // built-ins, which an ES module has no binding for.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __lemmaCreateRequire } from "node:module";',
      "const require = __lemmaCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

await chmod("dist/cli.mjs", 0o755);
