import {
  chmod,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunCommand } from "./command.js";
import {
  addPlaceholders,
  keptIngestLines,
  parseEnvAssignments,
  placeIngestKey,
  planEnvExample,
  planEnvTarget,
  plannedEnvNote,
  saveIngestKeyPrivately,
  singleValue,
  upsertEnvContents,
  writeEnvExample,
  type EnvTarget,
} from "./env-file.js";
import { posix, temporaryDirectories } from "./testing/temp.js";

const tempDir = temporaryDirectories("lemma-setup-env-");
const KEY = "lemma_sk_new_0123456789abcdef";
const PROJECT_ID = "3f0c6a52-0d6e-4a7b-9a51-2f4e2b9a6c11";
const GIT_WARNING =
  "Warning: git does not ignore .env. Add .env to .gitignore before you commit, so the key stays out of the repository.";

function gitAnswering(code: number | null): RunCommand {
  return async () => ({ code, stdout: "", stderr: "" });
}

function fallbackPath(directory: string): string {
  return join(directory, "saved", "keys.env");
}

async function envFileTarget(
  directory: string,
): Promise<Extract<EnvTarget, { kind: "env-file" }>> {
  const target = await planEnvTarget(
    join(directory, ".env"),
    fallbackPath(directory),
  );
  if (target.kind !== "env-file") throw new Error("expected an .env target");
  return target;
}

describe("parsing .env", () => {
  it("reads plain, exported, quoted, and commented values", () => {
    const assignments = parseEnvAssignments(
      [
        "# comment",
        "LEMMA_API_KEY=lemma_sk_old # rotated",
        `export LEMMA_PROJECT_ID="${PROJECT_ID}"`,
        "OTHER = 'x y'",
      ].join("\n"),
    );
    expect(singleValue(assignments, "LEMMA_API_KEY")).toBe("lemma_sk_old");
    expect(singleValue(assignments, "LEMMA_PROJECT_ID")).toBe(PROJECT_ID);
    expect(singleValue(assignments, "OTHER")).toBe("x y");
  });

  it("treats a missing, empty, or conflicting value as unknown", () => {
    const assignments = parseEnvAssignments(
      "LEMMA_API_KEY=a\nLEMMA_API_KEY=b\nEMPTY=\n",
    );
    expect(singleValue(assignments, "LEMMA_API_KEY")).toBeNull();
    expect(singleValue(assignments, "EMPTY")).toBeNull();
    expect(singleValue(assignments, "MISSING")).toBeNull();
  });

  it("replaces values in place, keeps other lines and CRLF, and adds only missing placeholders", () => {
    expect(
      upsertEnvContents(
        "OPENAI_API_KEY=sk-1\nexport LEMMA_API_KEY=old\n# keep\n",
        { LEMMA_API_KEY: KEY, LEMMA_PROJECT_ID: PROJECT_ID },
      ),
    ).toBe(
      `OPENAI_API_KEY=sk-1\nexport LEMMA_API_KEY=${KEY}\n# keep\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
    );
    expect(upsertEnvContents("A=1\r\nB=2", { B: "3", C: "4" })).toBe(
      "A=1\r\nB=3\r\nC=4\r\n",
    );
    expect(
      addPlaceholders("LEMMA_API_KEY=\n", [
        "LEMMA_API_KEY",
        "LEMMA_PROJECT_ID",
      ]),
    ).toEqual({
      contents: "LEMMA_API_KEY=\nLEMMA_PROJECT_ID=\n",
      added: ["LEMMA_PROJECT_ID"],
    });
  });
});

describe("planning the ingest key", () => {
  it("reads the existing key once, typed as none, unusable, or a key and its project", async () => {
    const directory = await tempDir();
    const env = join(directory, ".env");
    await expect(envFileTarget(directory)).resolves.toMatchObject({
      existing: { kind: "none" },
    });
    await writeFile(env, "LEMMA_API_KEY=\n");
    await expect(envFileTarget(directory)).resolves.toMatchObject({
      existing: { kind: "none" },
    });
    await writeFile(env, "LEMMA_API_KEY=lemma_sk_old\nLEMMA_PROJECT_ID=nope\n");
    await expect(envFileTarget(directory)).resolves.toMatchObject({
      existing: { kind: "unusable" },
    });
    await writeFile(
      env,
      `LEMMA_API_KEY=lemma_sk_old\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
    );
    await expect(envFileTarget(directory)).resolves.toMatchObject({
      existing: { kind: "key", apiKey: "lemma_sk_old", projectId: PROJECT_ID },
    });
  });

  it.skipIf(!posix)(
    "plans a symlinked .env as its private file and announces it",
    async () => {
      const directory = await tempDir();
      await writeFile(join(directory, "elsewhere"), "UNTOUCHED=1\n");
      await symlink(join(directory, "elsewhere"), join(directory, ".env"));
      const target = await planEnvTarget(
        join(directory, ".env"),
        fallbackPath(directory),
      );
      expect(target).toEqual({
        kind: "private",
        reason: `${join(directory, ".env")} is a symlink, so setup does not write it`,
        existing: { kind: "none" },
        fallbackPath: fallbackPath(directory),
      });
      expect(plannedEnvNote(target)).toBe(
        `.env: ${join(directory, ".env")} is a symlink, so setup does not write it. After approval, setup saves LEMMA_API_KEY and LEMMA_PROJECT_ID to ${fallbackPath(directory)} (readable only by you) instead.`,
      );
    },
  );

  it("plans a directory named .env as its private file", async () => {
    const directory = await tempDir();
    await mkdir(join(directory, ".env"));
    await expect(
      planEnvTarget(join(directory, ".env"), fallbackPath(directory)),
    ).resolves.toMatchObject({ kind: "private" });
  });
});

describe("placing the ingest key", () => {
  it("creates a new .env readable only by its owner", async () => {
    const directory = await tempDir();
    const placement = await placeIngestKey({
      target: await envFileTarget(directory),
      projectId: PROJECT_ID,
      apiKey: KEY,
      run: gitAnswering(0),
    });
    expect(placement).toEqual({
      placed: true,
      lines: [
        ".env: created with LEMMA_API_KEY and LEMMA_PROJECT_ID, readable only by you.",
      ],
    });
    expect(await readFile(join(directory, ".env"), "utf8")).toBe(
      `LEMMA_API_KEY=${KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
    );
    if (posix) {
      expect((await stat(join(directory, ".env"))).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(!posix)(
    "updates an existing .env in place, keeps its mode, and warns when others can read it or git does not ignore it",
    async () => {
      const directory = await tempDir();
      const env = join(directory, ".env");
      await writeFile(env, "DATABASE_URL=postgres://db\nLEMMA_API_KEY=old\n");
      await chmod(env, 0o640);
      const placement = await placeIngestKey({
        target: await envFileTarget(directory),
        projectId: PROJECT_ID,
        apiKey: KEY,
        run: gitAnswering(1),
      });
      expect(placement).toEqual({
        placed: true,
        lines: [
          ".env: set LEMMA_API_KEY and LEMMA_PROJECT_ID.",
          `Warning: other users on this machine can read ${env} (mode 640), which holds the ingest key. Run \`chmod 600 ${env}\` to keep it private.`,
          GIT_WARNING,
        ],
      });
      expect((await stat(env)).mode & 0o777).toBe(0o640);
      expect(await readFile(env, "utf8")).toBe(
        `DATABASE_URL=postgres://db\nLEMMA_API_KEY=${KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
      );
    },
  );

  it.skipIf(!posix)(
    "does not place the key when .env turns into a symlink after planning",
    async () => {
      const directory = await tempDir();
      const target = await envFileTarget(directory);
      await writeFile(join(directory, "elsewhere"), "UNTOUCHED=1\n");
      await symlink(join(directory, "elsewhere"), join(directory, ".env"));
      const placement = await placeIngestKey({
        target,
        projectId: PROJECT_ID,
        apiKey: KEY,
        run: gitAnswering(0),
      });
      expect(placement.placed).toBe(false);
      expect(!placement.placed && placement.reason).toContain(
        "is a symlink, so setup does not write it",
      );
      expect(await readFile(join(directory, "elsewhere"), "utf8")).toBe(
        "UNTOUCHED=1\n",
      );
    },
  );

  it("adds the git warning to a kept key's lines only for .env itself", async () => {
    const directory = await tempDir();
    await expect(
      keptIngestLines(await envFileTarget(directory), gitAnswering(1)),
    ).resolves.toEqual([
      ".env: kept LEMMA_API_KEY and LEMMA_PROJECT_ID; the key is already limited to this project.",
      GIT_WARNING,
    ]);
    await expect(
      keptIngestLines(
        {
          kind: "private",
          reason: "x",
          existing: { kind: "none" },
          fallbackPath: fallbackPath(directory),
        },
        gitAnswering(1),
      ),
    ).resolves.toHaveLength(1);
  });
});

describe("saving the ingest key privately", () => {
  it.skipIf(!posix)(
    "saves the key and project owner-only and names the file",
    async () => {
      const directory = await tempDir();
      const saved = await saveIngestKeyPrivately({
        fallbackPath: fallbackPath(directory),
        projectId: PROJECT_ID,
        apiKey: KEY,
        reason: "setup could not write .env (EACCES)",
      });
      expect(saved).toEqual({
        saved: true,
        lines: [
          `.env: setup could not write .env (EACCES). LEMMA_API_KEY and LEMMA_PROJECT_ID are in ${fallbackPath(directory)} (readable only by you); copy them where the app loads its environment, then delete that file.`,
        ],
      });
      expect(await readFile(fallbackPath(directory), "utf8")).toBe(
        `LEMMA_API_KEY=${KEY}\nLEMMA_PROJECT_ID=${PROJECT_ID}\n`,
      );
      expect((await stat(fallbackPath(directory))).mode & 0o777).toBe(0o600);
    },
  );
});

describe("updating .env.example", () => {
  it("creates it, appends only missing placeholders, and then leaves it alone", async () => {
    const path = join(await tempDir(), ".env.example");
    const examplePlan = await planEnvExample(path);
    expect(examplePlan).toEqual({ kind: "update", path });
    await expect(writeEnvExample(examplePlan)).resolves.toEqual([
      ".env.example: created with LEMMA_API_KEY= and LEMMA_PROJECT_ID=.",
    ]);
    await writeFile(path, "OPENAI_API_KEY=\nLEMMA_PROJECT_ID=\n");
    await expect(writeEnvExample(examplePlan)).resolves.toEqual([
      ".env.example: added LEMMA_API_KEY=.",
    ]);
    expect(await readFile(path, "utf8")).toBe(
      "OPENAI_API_KEY=\nLEMMA_PROJECT_ID=\nLEMMA_API_KEY=\n",
    );
    await expect(writeEnvExample(examplePlan)).resolves.toEqual([]);
  });

  it.skipIf(!posix)(
    "plans a skip for a symlinked .env.example, printed with the plan only",
    async () => {
      const directory = await tempDir();
      const path = join(directory, ".env.example");
      await writeFile(join(directory, "shared.example"), "SHARED=\n");
      await symlink(join(directory, "shared.example"), path);
      const examplePlan = await planEnvExample(path);
      expect(examplePlan).toEqual({
        kind: "skip",
        reason: `.env.example: ${path} is a symlink, so setup leaves it unchanged.`,
      });
      await expect(writeEnvExample(examplePlan)).resolves.toEqual([]);
      expect(await readFile(join(directory, "shared.example"), "utf8")).toBe(
        "SHARED=\n",
      );
    },
  );

  it("plans a skip for a .env.example that is not a file, and skips one that changed after planning", async () => {
    const directory = await tempDir();
    const path = join(directory, ".env.example");
    const examplePlan = await planEnvExample(path);
    await mkdir(path);
    await expect(planEnvExample(path)).resolves.toEqual({
      kind: "skip",
      reason: `.env.example: ${path} is not a regular file, so setup leaves it unchanged.`,
    });
    await expect(writeEnvExample(examplePlan)).resolves.toEqual([
      `.env.example: ${path} is not a regular file, so setup leaves it unchanged.`,
    ]);
  });
});
