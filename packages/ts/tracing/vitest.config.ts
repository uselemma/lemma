import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/client.ts", "src/experiment-mode.ts", "src/debug-mode.ts"],
      exclude: ["**/*.test.ts", "**/*.config.ts"],
      thresholds: {
        statements: 100,
        branches: 96,
        functions: 100,
        lines: 100,
      },
    },
  },
});
