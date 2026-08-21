import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type LemmaOpenClawCredentials = {
  version: 1;
  apiUrl: string;
  projectId: string;
  credentialId: string;
  accessToken: string;
};

export type StorageOptions = {
  dataDir?: string;
  stateDir?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export const LEMMA_OPENCLAW_CREDENTIALS_HELP =
  "Lemma OpenClaw credentials are missing or invalid. Run `pnpm dlx @uselemma/openclaw setup` to connect or rotate the scoped credential.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCredentials(value: unknown): value is LemmaOpenClawCredentials {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.apiUrl === "string" &&
    value.apiUrl.length > 0 &&
    typeof value.projectId === "string" &&
    value.projectId.length > 0 &&
    typeof value.credentialId === "string" &&
    value.credentialId.length > 0 &&
    typeof value.accessToken === "string" &&
    value.accessToken.length > 0
  );
}

export function resolveOpenClawStateDir(options: StorageOptions = {}): string {
  if (options.stateDir) return resolve(options.stateDir);
  const env = options.env ?? process.env;
  const configured = env.OPENCLAW_STATE_DIR?.trim();
  if (configured) return resolve(configured);
  const home = env.OPENCLAW_HOME?.trim() || options.homeDir || homedir();
  const current = join(resolve(home), ".openclaw");
  const legacy = join(resolve(home), ".clawdbot");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

function defaultDataDir(options: StorageOptions): string {
  return join(resolveOpenClawStateDir(options), "lemma");
}

function dataDirLocationPath(options: StorageOptions): string {
  return join(defaultDataDir(options), "data-dir-location.json");
}

export function resolveDataDir(options: StorageOptions = {}): string {
  if (options.dataDir) return resolve(options.dataDir);
  const env = options.env ?? process.env;
  const configured = env.LEMMA_OPENCLAW_DATA_DIR?.trim();
  if (configured) return resolve(configured);
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
      return resolve(value.dataDir);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return fallback;
}

export function credentialsPath(options: StorageOptions = {}): string {
  return join(resolveDataDir(options), "credentials.json");
}

async function writeSecureJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(dirname(path), 0o700);
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

export async function readCredentials(
  options: StorageOptions = {},
): Promise<LemmaOpenClawCredentials | null> {
  try {
    const value = JSON.parse(
      await readFile(credentialsPath(options), "utf8"),
    ) as unknown;
    if (!isCredentials(value)) throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
    }
    throw error;
  }
}

export async function writeCredentials(
  credentials: LemmaOpenClawCredentials,
  options: StorageOptions = {},
): Promise<void> {
  if (!isCredentials(credentials)) {
    throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
  }
  await writeSecureJson(credentialsPath(options), credentials);
}

export async function writeDataDirLocation(
  dataDir: string,
  options: StorageOptions = {},
): Promise<void> {
  const absolute = resolve(dataDir);
  const fallback = defaultDataDir(options);
  const locationPath = dataDirLocationPath(options);
  if (absolute === fallback) {
    await unlink(locationPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    return;
  }
  await writeSecureJson(locationPath, { version: 1, dataDir: absolute });
}
