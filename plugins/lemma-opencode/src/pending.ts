import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CompletedCodingAgentTurn } from "@uselemma/tracing";

import {
  resolveDataDir,
  type LemmaOpenCodeCredentialScope,
  type StorageOptions,
} from "./storage.js";

export type PendingOpenCodeTurn = {
  version: 1;
  apiUrl: string;
  projectId: string;
  credentialId: string;
  turn: CompletedCodingAgentTurn;
};

export function isPendingOpenCodeTurn(
  value: unknown,
): value is PendingOpenCodeTurn {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const pending = value as Record<string, unknown>;
  const turn = pending.turn;
  return (
    pending.version === 1 &&
    typeof pending.apiUrl === "string" &&
    typeof pending.projectId === "string" &&
    typeof pending.credentialId === "string" &&
    typeof turn === "object" &&
    turn !== null &&
    !Array.isArray(turn) &&
    (turn as Record<string, unknown>).harness === "opencode" &&
    (turn as Record<string, unknown>).status === "completed"
  );
}

export async function writePendingTurn(
  turn: CompletedCodingAgentTurn,
  scope: LemmaOpenCodeCredentialScope,
  options: StorageOptions = {},
): Promise<boolean> {
  const pendingDir = join(resolveDataDir(options), "pending");
  await mkdir(pendingDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(pendingDir, 0o700);
  const entry = `${turn.endedAt.replaceAll(/[^0-9]/g, "")}-${turn.traceId}-${randomUUID()}.json`;
  const path = join(pendingDir, entry);
  const temporaryPath = `${path}.tmp`;
  const pending: PendingOpenCodeTurn = {
    version: 1,
    apiUrl: scope.apiUrl,
    projectId: scope.projectId,
    credentialId: scope.credentialId,
    turn,
  };
  await writeFile(temporaryPath, `${JSON.stringify(pending)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  return true;
}
