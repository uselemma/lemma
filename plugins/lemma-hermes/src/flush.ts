import { mkdir, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
  type CompletedCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";

import {
  LEMMA_HERMES_CREDENTIALS_HELP,
  readCredentials,
  resolveDataDir,
  type StorageOptions,
} from "./credentials.js";
import { createDeliveryFetch } from "./delivery.js";
import type { HermesTurn, PendingHermesTurn } from "./types.js";

const FLUSH_LOCK_STALE_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHermesTurn(value: unknown): value is HermesTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.sessionId === "string" &&
    typeof value.turnId === "string" &&
    typeof value.prompt === "string" &&
    typeof value.response === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.endedAt === "string" &&
    Array.isArray(value.tools)
  );
}

function isPendingTurn(value: unknown): value is PendingHermesTurn {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    typeof value.projectId === "string" &&
    isHermesTurn(value.turn)
  );
}

export function mapHermesTurn(turn: HermesTurn): CompletedCodingAgentTurn {
  let mapped = startCodingAgentTurn({
    harness: "hermes",
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    prompt: turn.prompt,
    startedAt: turn.startedAt,
    model: turn.model,
    provider: turn.provider,
    metadata: {
      "lemma.harness.session_event_source": "native-plugin-hooks",
      ...(turn.metadata ?? {}),
    },
  });
  for (const tool of turn.tools) {
    if (tool.startedAt) {
      mapped = recordCodingAgentToolStart(mapped, {
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        input: tool.input,
        startedAt: tool.startedAt,
      });
    }
    if (tool.endedAt) {
      mapped = recordCodingAgentToolResult(mapped, {
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        input: tool.input,
        output: tool.output,
        error: tool.error,
        endedAt: tool.endedAt,
      });
    }
  }
  return completeCodingAgentTurn(mapped, {
    response: turn.response,
    endedAt: turn.endedAt,
    model: turn.model,
    provider: turn.provider,
    ...(turn.generationStartedAt && turn.generationEndedAt
      ? {
          generationStartedAt: turn.generationStartedAt,
          generationEndedAt: turn.generationEndedAt,
        }
      : {}),
  });
}

export type FlushOptions = StorageOptions & {
  fetch?: typeof fetch;
  warn?: (message: string) => void;
};

async function acquireFlushLock(
  dataDir: string,
): Promise<(() => Promise<void>) | null> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, "flush.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt > 0) return null;
      const lockStat = await stat(lockPath).catch(
        (statError: unknown) => {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw statError;
        },
      );
      if (lockStat && Date.now() - lockStat.mtimeMs <= FLUSH_LOCK_STALE_MS) {
        return null;
      }
      await rm(lockPath, { recursive: true, force: true });
    }
  }
  return null;
}

export async function flushPendingTurns(options: FlushOptions = {}): Promise<number> {
  const dataDir = resolveDataDir(options);
  const releaseLock = await acquireFlushLock(dataDir);
  if (!releaseLock) return 0;
  try {
    const credentials = await readCredentials({ ...options, dataDir });
    if (!credentials) throw new Error(LEMMA_HERMES_CREDENTIALS_HELP);
    const pendingDir = join(dataDir, "pending");
    const entries = await readdir(pendingDir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    let sent = 0;
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const path = join(pendingDir, entry);
      try {
        const pending = JSON.parse(await readFile(path, "utf8")) as unknown;
        if (!isPendingTurn(pending)) throw new Error("invalid pending turn");
        if (
          pending.apiUrl !== credentials.apiUrl ||
          pending.projectId !== credentials.projectId
        ) {
          throw new Error("pending turn belongs to a different scoped credential");
        }
        const turn = mapHermesTurn(pending.turn);
        const trace = codingAgentTurnTrace(turn);
        await new Lemma({
          apiKey: credentials.accessToken,
          projectId: credentials.projectId,
          baseUrl: credentials.apiUrl,
          fetch: createDeliveryFetch(options.fetch),
        }).ingest(trace.context, {
          startedAt: new Date(trace.startedAt),
          endedAt: new Date(trace.endedAt),
        });
        await unlink(path);
        sent += 1;
      } catch {
        options.warn?.(`Lemma Hermes retained a trace for retry (${entry}).`);
      }
    }
    return sent;
  } finally {
    await releaseLock();
  }
}
