import { readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type LemmaPiCredentials = {
  version: 1;
  apiUrl: string;
  projectId: string;
  credentialId: string;
  accessToken: string;
};

export type CredentialOptions = {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export const LEMMA_PI_CREDENTIALS_HELP =
  "Lemma Pi credentials are missing or invalid. Run `pnpm dlx @uselemma/pi setup` to connect or rotate the scoped credential.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCredentials(value: unknown): value is LemmaPiCredentials {
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

export function resolveDataDir(options: CredentialOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = options.dataDir ?? env.LEMMA_PI_DATA_DIR;
  return configured
    ? resolve(configured)
    : join(options.homeDir ?? homedir(), ".pi", "agent", "lemma");
}

export function credentialsPath(options: CredentialOptions = {}): string {
  return join(resolveDataDir(options), "credentials.json");
}

export function readCredentialsSync(
  options: CredentialOptions = {},
): LemmaPiCredentials | null {
  try {
    const value = JSON.parse(
      readFileSync(credentialsPath(options), "utf8"),
    ) as unknown;
    if (!isCredentials(value)) throw new Error(LEMMA_PI_CREDENTIALS_HELP);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError)
      throw new Error(LEMMA_PI_CREDENTIALS_HELP);
    throw error;
  }
}

export function requireCredentials(
  options: CredentialOptions & { credentials?: LemmaPiCredentials } = {},
): LemmaPiCredentials {
  if (options.credentials) {
    if (!isCredentials(options.credentials))
      throw new Error(LEMMA_PI_CREDENTIALS_HELP);
    return options.credentials;
  }
  const credentials = readCredentialsSync(options);
  if (!credentials) throw new Error(LEMMA_PI_CREDENTIALS_HELP);
  return credentials;
}

export async function writeCredentials(
  credentials: LemmaPiCredentials,
  options: CredentialOptions = {},
): Promise<void> {
  if (!isCredentials(credentials)) throw new Error(LEMMA_PI_CREDENTIALS_HELP);
  const path = credentialsPath(options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(dirname(path), 0o700);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(credentials)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}
