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

export type LemmaCodexCredentials = {
  version: 1;
  apiUrl: string;
  projectId: string;
  credentialId: string;
  accessToken: string;
};

type PendingCodingAgentTurn = {
  version: 1;
  apiUrl: string;
  projectId: string;
  turn: CompletedCodingAgentTurn;
  deliveryId?: string;
  readyAt?: string;
  sourceRevision?: string;
};

export type StorageOptions = {
  dataDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

type DataDirLocation = { version: 1; dataDir: string };

function safeId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultDataDir(options: StorageOptions): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const platformPath = platform === "win32" ? win32 : posix;
  if (platform === "darwin") {
    return platformPath.join(
      home,
      "Library",
      "Application Support",
      "Lemma",
      "Codex",
    );
  }
  if (platform === "win32") {
    return platformPath.join(
      env.LOCALAPPDATA?.trim() ||
        env.APPDATA?.trim() ||
        platformPath.join(home, "AppData", "Local"),
      "Lemma",
      "Codex",
    );
  }
  return platformPath.join(
    env.XDG_STATE_HOME?.trim() || platformPath.join(home, ".local", "state"),
    "lemma",
    "codex",
  );
}

function dataDirLocationPath(options: StorageOptions): string {
  return join(defaultDataDir(options), "data-dir-location.json");
}

export function resolveDataDir(options: StorageOptions = {}): string {
  if (options.dataDir) return options.dataDir;
  const env = options.env ?? process.env;
  const override = env.LEMMA_CODEX_DATA_DIR?.trim();
  if (override) return override;
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
      return value.dataDir;
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

export async function writeSecureJson(
  path: string,
  value: unknown,
): Promise<void> {
  const parent = dirname(path);
  await ensurePrivateDirectory(parent);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCredentials(value: unknown): value is LemmaCodexCredentials {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    typeof value.projectId === "string" &&
    typeof value.credentialId === "string" &&
    typeof value.accessToken === "string"
  );
}

export function isCodingAgentTurn(value: unknown): value is CodingAgentTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.status === "open" || value.status === "completed") &&
    typeof value.harness === "string" &&
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

export function codingAgentTurnRevision(turn: CodingAgentTurn): string {
  return createHash("sha256").update(JSON.stringify(turn)).digest("hex");
}

function isPendingCodingAgentTurn(
  value: unknown,
): value is PendingCodingAgentTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    typeof value.projectId === "string" &&
    (value.deliveryId === undefined || typeof value.deliveryId === "string") &&
    (value.readyAt === undefined || typeof value.readyAt === "string") &&
    (value.sourceRevision === undefined ||
      typeof value.sourceRevision === "string") &&
    isCodingAgentTurn(value.turn) &&
    value.turn.status === "completed"
  );
}

export function credentialsPath(dataDir: string): string {
  return join(dataDir, "credentials.json");
}

function turnPath(dataDir: string, sessionId: string, turnId: string): string {
  return join(dataDir, "turns", `${safeId(`${sessionId}\0${turnId}`)}.json`);
}

function pendingPath(dataDir: string, traceId: string): string {
  return join(dataDir, "pending", `${safeId(traceId)}.json`);
}

export async function readCredentials(
  dataDir: string,
): Promise<LemmaCodexCredentials | null> {
  const value = await readJson(credentialsPath(dataDir));
  if (value === null) return null;
  if (!isCredentials(value))
    throw new Error("Lemma Codex credentials are invalid");
  return value;
}

export async function writeCredentials(
  dataDir: string,
  credentials: LemmaCodexCredentials,
): Promise<void> {
  await writeSecureJson(credentialsPath(dataDir), credentials);
}

export async function writeDataDirLocation(
  dataDir: string,
  options: StorageOptions = {},
): Promise<void> {
  const fallback = defaultDataDir(options);
  const locationPath = dataDirLocationPath(options);
  if (dataDir === fallback) {
    await unlink(locationPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return;
  }
  await writeSecureJson(locationPath, {
    version: 1,
    dataDir,
  } satisfies DataDirLocation);
}

export async function readTurn(
  dataDir: string,
  sessionId: string,
  turnId: string,
): Promise<CodingAgentTurn | null> {
  const value = await readJson(turnPath(dataDir, sessionId, turnId));
  if (value === null) return null;
  if (!isCodingAgentTurn(value))
    throw new Error("Lemma Codex turn state is invalid");
  return value;
}

export async function writeTurn(
  dataDir: string,
  turn: CodingAgentTurn,
): Promise<void> {
  await writeSecureJson(turnPath(dataDir, turn.sessionId, turn.turnId), turn);
}

export async function queueCompletedTurn(
  dataDir: string,
  turn: CompletedCodingAgentTurn,
  destination: Pick<LemmaCodexCredentials, "apiUrl" | "projectId">,
  options: { readyAt?: string; sourceRevision?: string } = {},
): Promise<void> {
  await writeSecureJson(pendingPath(dataDir, turn.traceId), {
    version: 1,
    apiUrl: destination.apiUrl,
    projectId: destination.projectId,
    turn,
    deliveryId: randomUUID(),
    readyAt: options.readyAt,
    sourceRevision: options.sourceRevision,
  } satisfies PendingCodingAgentTurn);
}

export async function removePendingTurn(
  dataDir: string,
  traceId: string,
): Promise<void> {
  await removePending(pendingPath(dataDir, traceId));
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

export async function removeAbandonedTurns(
  dataDir: string,
  options: {
    sessionId: string;
    currentTurnId: string;
    olderThan: Date;
  },
): Promise<number> {
  const directory = join(dataDir, "turns");
  const entries = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  let removed = 0;
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    const path = join(directory, entry);
    const value = await readJson(path);
    if (!isCodingAgentTurn(value) || value.status !== "open") continue;
    const supersededInSession =
      value.sessionId === options.sessionId &&
      value.turnId !== options.currentTurnId;
    const isExpired = Date.parse(value.startedAt) < options.olderThan.getTime();
    if (!supersededInSession && !isExpired) continue;
    await unlink(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    removed += 1;
  }
  return removed;
}

export async function listPendingTurns(dataDir: string): Promise<
  Array<{
    path: string;
    apiUrl: string;
    projectId: string;
    turn: CompletedCodingAgentTurn;
    deliveryId?: string;
    readyAt?: string;
    sourceRevision?: string;
  }>
> {
  const directory = join(dataDir, "pending");
  const entries = await readdir(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const pending: Array<{
    path: string;
    apiUrl: string;
    projectId: string;
    turn: CompletedCodingAgentTurn;
    deliveryId?: string;
    readyAt?: string;
    sourceRevision?: string;
  }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(directory, entry);
    const value = await readJson(path);
    if (!isPendingCodingAgentTurn(value)) {
      throw new Error(`Lemma Codex pending turn is invalid: ${entry}`);
    }
    pending.push({
      path,
      apiUrl: value.apiUrl,
      projectId: value.projectId,
      turn: value.turn,
      deliveryId: value.deliveryId,
      readyAt: value.readyAt,
      sourceRevision: value.sourceRevision,
    });
  }
  return pending;
}

export async function readPendingTurn(
  path: string,
): Promise<
  | {
      path: string;
      apiUrl: string;
      projectId: string;
      turn: CompletedCodingAgentTurn;
      deliveryId?: string;
      readyAt?: string;
      sourceRevision?: string;
    }
  | null
> {
  const value = await readJson(path);
  if (value === null) return null;
  if (!isPendingCodingAgentTurn(value)) {
    throw new Error(`Lemma Codex pending turn is invalid: ${path}`);
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
        throw new Error("Timed out waiting for Lemma Codex turn state lock");
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
