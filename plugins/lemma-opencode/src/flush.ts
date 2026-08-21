import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { codingAgentTurnTrace, Lemma } from "@uselemma/tracing";

import { createDeliveryFetch, DELIVERY_TIMEOUT_MS } from "./delivery.js";
import { isPendingOpenCodeTurn } from "./pending.js";
import {
  LEMMA_OPENCODE_CREDENTIALS_HELP,
  readCredentials,
  resolveDataDir,
  type StorageOptions,
} from "./storage.js";

const FLUSH_LOCK_STALE_MS = 30_000;
const FLUSH_LOCK_OWNER_FILE = "owner.json";
export const DEFAULT_FLUSH_TIMEOUT_MS = 10_000;

type FlushLockOwner = { pid: number; id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type FlushOptions = StorageOptions & {
  deadline?: number;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMilliseconds?: number;
  warn?: (message: string) => void;
};

async function readLockOwner(path: string): Promise<FlushLockOwner | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      isRecord(value) &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.id === "string" &&
      value.id.length > 0
    ) {
      return { pid: value.pid, id: value.id };
    }
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      !(error instanceof SyntaxError)
    ) {
      throw error;
    }
  }
  return null;
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function acquireFlushLock(
  dataDir: string,
): Promise<(() => Promise<void>) | null> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, "flush.lock");
  const ownerPath = join(lockPath, FLUSH_LOCK_OWNER_FILE);
  const owner: FlushLockOwner = { pid: process.pid, id: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return async () => {
        const currentOwner = await readLockOwner(ownerPath);
        if (currentOwner?.id === owner.id) {
          await rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt > 0) return null;
      const currentOwner = await readLockOwner(ownerPath);
      if (currentOwner && processIsRunning(currentOwner.pid)) return null;
      const lockStat = await stat(lockPath).catch((statError: unknown) => {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw statError;
      });
      if (lockStat && Date.now() - lockStat.mtimeMs <= FLUSH_LOCK_STALE_MS) {
        return null;
      }
      const quarantinePath = join(dataDir, `flush.lock.stale-${randomUUID()}`);
      try {
        await rename(lockPath, quarantinePath);
      } catch (claimError) {
        if ((claimError as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw claimError;
      }
      await rm(quarantinePath, { recursive: true, force: true });
    }
  }
  return null;
}

async function pendingEntryNames(dataDir: string): Promise<string[]> {
  return readdir(join(dataDir, "pending"))
    .then((entries) => entries.filter((name) => name.endsWith(".json")).sort())
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
}

export async function flushPendingTurns(
  options: FlushOptions = {},
): Promise<number> {
  const dataDir = resolveDataDir(options);
  const now = options.now ?? Date.now;
  const deadline =
    options.deadline ??
    now() + (options.timeoutMilliseconds ?? DEFAULT_FLUSH_TIMEOUT_MS);
  let sent = 0;
  const attemptedEntries = new Set<string>();
  while (true) {
    const releaseLock = await acquireFlushLock(dataDir);
    if (!releaseLock) return sent;
    try {
      const credentials = await readCredentials({ ...options, dataDir });
      if (!credentials) throw new Error(LEMMA_OPENCODE_CREDENTIALS_HELP);
      const pendingDir = join(dataDir, "pending");
      for (const entry of (await pendingEntryNames(dataDir)).filter(
        (name) => !attemptedEntries.has(name),
      )) {
        const remainingMilliseconds = deadline - now();
        if (remainingMilliseconds <= 0) return sent;
        attemptedEntries.add(entry);
        const path = join(pendingDir, entry);
        try {
          const pending = JSON.parse(await readFile(path, "utf8")) as unknown;
          if (!isPendingOpenCodeTurn(pending)) {
            throw new Error("invalid pending turn");
          }
          if (
            pending.apiUrl !== credentials.apiUrl ||
            pending.projectId !== credentials.projectId
          ) {
            throw new Error(
              "pending turn belongs to a different scoped credential",
            );
          }
          const trace = codingAgentTurnTrace(pending.turn);
          await new Lemma({
            apiKey: credentials.accessToken,
            projectId: credentials.projectId,
            baseUrl: credentials.apiUrl,
            fetch: createDeliveryFetch(
              options.fetch,
              Math.min(DELIVERY_TIMEOUT_MS, remainingMilliseconds),
            ),
          }).ingest(trace.context, {
            startedAt: new Date(trace.startedAt),
            endedAt: new Date(trace.endedAt),
          });
          await unlink(path);
          sent += 1;
        } catch {
          options.warn?.(
            `Lemma OpenCode retained a trace for retry (${entry}).`,
          );
        }
      }
    } finally {
      await releaseLock();
    }
    const remainingEntries = await pendingEntryNames(dataDir);
    if (!remainingEntries.some((entry) => !attemptedEntries.has(entry))) {
      return sent;
    }
  }
}
