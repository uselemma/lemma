import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  readCredentials,
  resolveDataDir,
  type StorageOptions,
} from "./storage.js";
import type { OpenClawTurn, PendingOpenClawTurn } from "./types.js";

export async function writePendingTurn(
  turn: OpenClawTurn,
  options: StorageOptions = {},
): Promise<string | null> {
  const dataDir = resolveDataDir(options);
  const credentials = await readCredentials({ ...options, dataDir });
  if (!credentials) return null;
  const pendingDir = join(dataDir, "pending");
  await mkdir(pendingDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(pendingDir, 0o700);
  const digest = createHash("sha256")
    .update(`${turn.sessionId}\0${turn.turnId}`)
    .digest("hex");
  const target = join(pendingDir, `${digest}.json`);
  const temporary = join(
    pendingDir,
    `.${digest}.${process.pid}.${randomUUID()}.tmp`,
  );
  const payload: PendingOpenClawTurn = {
    version: 1,
    apiUrl: credentials.apiUrl,
    projectId: credentials.projectId,
    turn,
  };
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, target);
  if (process.platform !== "win32") await chmod(target, 0o600);
  return target;
}
