import { unlink } from "node:fs/promises";

import { isLemmaApiUrl, type LemmaApiUrl } from "./api.js";
import { failureReason, SetupError } from "./errors.js";
import { readRegularFile, writePrivateFile } from "./files.js";
import { isHarnessId, type HarnessId } from "./harness.js";
import { isRecord, isUuid } from "./shared.js";

const PENDING_SCHEMA_VERSION = 1;

/** A started handshake that `wait` can poll; deleted once its code is spent. */
export type PendingSetup = {
  version: typeof PENDING_SCHEMA_VERSION;
  appDir: string;
  apiUrl: LemmaApiUrl;
  harness: HarnessId;
  /** The command's only proof of the handshake, hence the owner-only file. */
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  interval: number;
  /** Epoch milliseconds; the server refuses polls sooner than the interval. */
  nextPollAt: number;
  existingIngestProjectId: string | null;
  existingMcpTenantId: string | null;
};

export function newPendingSetup(
  fields: Omit<PendingSetup, "version">,
): PendingSetup {
  return { version: PENDING_SCHEMA_VERSION, ...fields };
}

export async function writePendingSetup(
  path: string,
  pending: PendingSetup,
): Promise<void> {
  await writePrivateFile(path, `${JSON.stringify(pending, null, 2)}\n`);
}

const NO_PENDING_SETUP =
  "No setup is waiting for approval in this directory. Run `start` first.";

function isPendingSetup(value: unknown): value is PendingSetup {
  if (!isRecord(value)) return false;
  const optionalUuid = (field: unknown) => field === null || isUuid(field);
  return (
    value.version === PENDING_SCHEMA_VERSION &&
    typeof value.appDir === "string" &&
    typeof value.apiUrl === "string" &&
    isLemmaApiUrl(value.apiUrl) &&
    typeof value.harness === "string" &&
    isHarnessId(value.harness) &&
    typeof value.deviceCode === "string" &&
    typeof value.userCode === "string" &&
    typeof value.verificationUriComplete === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.interval === "number" &&
    typeof value.nextPollAt === "number" &&
    optionalUuid(value.existingIngestProjectId) &&
    optionalUuid(value.existingMcpTenantId)
  );
}

export async function readPendingSetup(
  path: string,
  appDir: string,
): Promise<PendingSetup> {
  const file = await readRegularFile(path);
  if (!file) throw new SetupError(NO_PENDING_SETUP);
  let value: unknown;
  try {
    value = JSON.parse(file.contents);
  } catch {
    value = null;
  }
  if (!isPendingSetup(value) || value.appDir !== appDir) {
    throw new SetupError(
      `The pending setup in ${path} is unreadable. Run \`start\` again.`,
    );
  }
  return value;
}

/**
 * Deletes the handshake file once its code is spent, and returns the lines
 * to print. It never throws: the keys that code returned matter more than
 * the file, and a file left behind only makes the next `wait` find the code
 * spent.
 */
export async function deletePendingSetup(path: string): Promise<string[]> {
  try {
    await unlink(path);
    return [];
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? []
      : [
          `Warning: setup could not delete ${path} (${failureReason(error)}). Its code is spent, so the file is safe to delete.`,
        ];
  }
}
