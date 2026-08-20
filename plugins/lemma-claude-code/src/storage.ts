import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

import type {
  CodingAgentTurn,
  CompletedCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";

export type LemmaClaudeCodeCredentials = {
  version: 1;
  apiUrl: string;
  projectId: string;
  credentialId: string;
  accessToken: string;
};

export type StagedClaudePrompt = {
  version: 1;
  sessionId: string;
  prompt: string;
  startedAt: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type PendingClaudeTurn = {
  version: 1;
  apiUrl: string;
  projectId: string;
  turn: CompletedCodingAgentTurn;
  deliveryId: string;
};

export type StorageOptions = {
  dataDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

type DataDirLocation = { version: 1; dataDir: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathImplementation(options: StorageOptions): typeof posix {
  return (options.platform ?? process.platform) === "win32" ? win32 : posix;
}

function absoluteDataDir(value: string, options: StorageOptions): string {
  return pathImplementation(options).resolve(value);
}

function defaultDataDir(options: StorageOptions): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const platformPath = pathImplementation(options);
  if (platform === "darwin") {
    return platformPath.join(
      home,
      "Library",
      "Application Support",
      "Lemma",
      "Claude Code",
    );
  }
  if (platform === "win32") {
    return platformPath.join(
      env.LOCALAPPDATA?.trim() ||
        env.APPDATA?.trim() ||
        platformPath.join(home, "AppData", "Local"),
      "Lemma",
      "Claude Code",
    );
  }
  return platformPath.join(
    env.XDG_STATE_HOME?.trim() || platformPath.join(home, ".local", "state"),
    "lemma",
    "claude-code",
  );
}

function dataDirLocationPath(options: StorageOptions): string {
  return pathImplementation(options).join(
    defaultDataDir(options),
    "data-dir-location.json",
  );
}

export function resolveDataDir(options: StorageOptions = {}): string {
  if (options.dataDir) return absoluteDataDir(options.dataDir, options);
  const env = options.env ?? process.env;
  const override = env.LEMMA_CLAUDE_CODE_DATA_DIR?.trim();
  if (override) return absoluteDataDir(override, options);
  const fallback = defaultDataDir(options);
  try {
    const value = JSON.parse(
      readFileSync(dataDirLocationPath(options), "utf8"),
    ) as unknown;
    if (
      isRecord(value) &&
      value.version === 1 &&
      typeof value.dataDir === "string" &&
      value.dataDir.trim().length > 0
    ) {
      return absoluteDataDir(value.dataDir, options);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return fallback;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(path, 0o700);
}

async function writeSecureJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isCredentials(value: unknown): value is LemmaClaudeCodeCredentials {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    typeof value.projectId === "string" &&
    typeof value.credentialId === "string" &&
    typeof value.accessToken === "string"
  );
}

function isCodingAgentTurn(value: unknown): value is CodingAgentTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.status === "open" || value.status === "completed") &&
    value.harness === "claude-code" &&
    typeof value.sessionId === "string" &&
    typeof value.turnId === "string" &&
    typeof value.traceId === "string" &&
    typeof value.generationId === "string" &&
    typeof value.prompt === "string" &&
    typeof value.startedAt === "string" &&
    Array.isArray(value.tools) &&
    (value.status === "open" ||
      (typeof value.response === "string" && typeof value.endedAt === "string"))
  );
}

function isStagedPrompt(value: unknown): value is StagedClaudePrompt {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    typeof value.prompt === "string" &&
    typeof value.startedAt === "string" &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
}

function isPendingTurn(value: unknown): value is PendingClaudeTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    typeof value.projectId === "string" &&
    typeof value.deliveryId === "string" &&
    isCodingAgentTurn(value.turn) &&
    value.turn.status === "completed"
  );
}

export function credentialsPath(dataDir: string): string {
  return join(dataDir, "credentials.json");
}

function stagedPromptPath(dataDir: string, sessionId: string): string {
  return join(dataDir, "staged", `${safeId(sessionId)}.json`);
}

function turnPath(dataDir: string, sessionId: string, turnId: string): string {
  return join(dataDir, "turns", `${safeId(`${sessionId}\0${turnId}`)}.json`);
}

function pendingPath(dataDir: string, traceId: string): string {
  return join(dataDir, "pending", `${safeId(traceId)}.json`);
}

export async function readCredentials(
  dataDir: string,
): Promise<LemmaClaudeCodeCredentials | null> {
  const value = await readJson(credentialsPath(dataDir));
  if (value === null) return null;
  if (!isCredentials(value)) {
    throw new Error("Lemma Claude Code credentials are invalid");
  }
  return value;
}

export async function writeCredentials(
  dataDir: string,
  credentials: LemmaClaudeCodeCredentials,
): Promise<void> {
  await writeSecureJson(credentialsPath(dataDir), credentials);
}

export async function writeDataDirLocation(
  dataDir: string,
  options: StorageOptions = {},
): Promise<void> {
  const absolute = absoluteDataDir(dataDir, options);
  const fallback = defaultDataDir(options);
  const locationPath = dataDirLocationPath(options);
  if (absolute === fallback) {
    await unlink(locationPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return;
  }
  await writeSecureJson(locationPath, {
    version: 1,
    dataDir: absolute,
  } satisfies DataDirLocation);
}

export async function readStagedPrompt(
  dataDir: string,
  sessionId: string,
): Promise<StagedClaudePrompt | null> {
  const value = await readJson(stagedPromptPath(dataDir, sessionId));
  if (value === null) return null;
  if (!isStagedPrompt(value)) {
    throw new Error("Lemma Claude Code staged prompt is invalid");
  }
  return value;
}

export async function writeStagedPrompt(
  dataDir: string,
  prompt: StagedClaudePrompt,
): Promise<void> {
  await writeSecureJson(stagedPromptPath(dataDir, prompt.sessionId), prompt);
}

export async function removeStagedPrompt(
  dataDir: string,
  sessionId: string,
): Promise<void> {
  await unlink(stagedPromptPath(dataDir, sessionId)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export async function readTurn(
  dataDir: string,
  sessionId: string,
  turnId: string,
): Promise<CodingAgentTurn | null> {
  const value = await readJson(turnPath(dataDir, sessionId, turnId));
  if (value === null) return null;
  if (!isCodingAgentTurn(value)) {
    throw new Error("Lemma Claude Code turn state is invalid");
  }
  return value;
}

export async function writeTurn(
  dataDir: string,
  turn: CodingAgentTurn,
): Promise<void> {
  await writeSecureJson(turnPath(dataDir, turn.sessionId, turn.turnId), turn);
}

export async function removeTurn(
  dataDir: string,
  sessionId: string,
  turnId: string,
): Promise<void> {
  await unlink(turnPath(dataDir, sessionId, turnId)).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export async function queueCompletedTurn(
  dataDir: string,
  turn: CompletedCodingAgentTurn,
  destination: Pick<LemmaClaudeCodeCredentials, "apiUrl" | "projectId">,
): Promise<void> {
  const path = pendingPath(dataDir, turn.traceId);
  const existing = await readJson(path);
  if (existing !== null) {
    if (!isPendingTurn(existing)) {
      throw new Error("Lemma Claude Code pending turn is invalid");
    }
    return;
  }
  await writeSecureJson(path, {
    version: 1,
    apiUrl: destination.apiUrl,
    projectId: destination.projectId,
    turn,
    deliveryId: randomUUID(),
  } satisfies PendingClaudeTurn);
}

export async function listPendingTurns(
  dataDir: string,
): Promise<Array<PendingClaudeTurn & { path: string }>> {
  const directory = join(dataDir, "pending");
  const entries = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const pending: Array<PendingClaudeTurn & { path: string }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(directory, entry);
    const value = await readJson(path);
    if (!isPendingTurn(value)) {
      throw new Error(`Lemma Claude Code pending turn is invalid: ${entry}`);
    }
    pending.push({ path, ...value });
  }
  return pending;
}

export async function readPendingTurn(
  path: string,
): Promise<(PendingClaudeTurn & { path: string }) | null> {
  const value = await readJson(path);
  if (value === null) return null;
  if (!isPendingTurn(value)) {
    throw new Error("Lemma Claude Code pending turn is invalid");
  }
  return { path, ...value };
}

export async function removePending(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withSessionLock<T>(
  dataDir: string,
  sessionId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockDirectory = join(dataDir, "locks", `${safeId(sessionId)}.lock`);
  await ensurePrivateDirectory(dirname(lockDirectory));
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockDirectory).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) {
        await rmdir(lockDirectory).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for Lemma Claude Code turn state lock",
        );
      }
      await sleep(20);
    }
  }
  try {
    return await callback();
  } finally {
    await rmdir(lockDirectory).catch(() => undefined);
  }
}
