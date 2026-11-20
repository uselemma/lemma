import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "./errors.js";
import { cursorConfigPath } from "./mcp/paths.js";
import { plainNotFound } from "./testing/mock-api.js";
import {
  EXISTING_KEY,
  PROJECT_ID,
  rejection,
  setupRuns,
} from "./testing/setup-run.js";

const UNAVAILABLE =
  "Coding-agent setup isn't available on this Lemma environment yet. Use manual setup in the dashboard.";

const { setUp } = setupRuns();

describe("an environment without coding-agent setup", () => {
  it("start says so in one line, exits with 1, and writes nothing", async () => {
    const run = await setUp({
      api: { start: plainNotFound, keys: { [EXISTING_KEY]: plainNotFound } },
      prepare: async (app) => {
        await writeFile(
          join(app, ".env"),
          `LEMMA_API_KEY=${EXISTING_KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
        );
      },
    });
    const error = await rejection(run.start());
    expect(error.message).toBe(UNAVAILABLE);
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    expect(run.lines).toEqual([]);
    expect(run.opened).toEqual([]);
    await expect(stat(run.pendingPath)).rejects.toThrow();
    await expect(stat(join(run.app, ".env.example"))).rejects.toThrow();
  });

  it("wait says so when a poll gets a plain 404, exits with 1, and writes nothing", async () => {
    const run = await setUp({ api: { polls: [plainNotFound] } });
    await run.start();
    const saved = await readFile(run.pendingPath, "utf8");
    const error = await rejection(run.wait());
    expect(error.message).toBe(UNAVAILABLE);
    expect(error.exitCode).toBe(EXIT_CODES.failure);
    await expect(stat(join(run.app, ".env"))).rejects.toThrow();
    await expect(
      stat(cursorConfigPath({ homeDir: run.home, env: {} })),
    ).rejects.toThrow();
    expect(await readFile(run.pendingPath, "utf8")).toBe(saved);
  });
});
