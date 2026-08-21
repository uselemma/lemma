import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import {
  pluginPath,
  resolveConfigDir,
  resolveDataDir,
  writeCredentials,
  writeDataDirLocation,
  type LemmaOpenCodeCredentials,
  type StorageOptions,
} from "./storage.js";

const DEFAULT_API_URL = "https://api.uselemma.ai";
const MANAGED_PLUGIN_MARKER = "// @uselemma/opencode managed plugin";

type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

type DeviceTokenResult =
  | { status: "authorization_pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | { status: "expired_token" }
  | { status: "access_denied" }
  | {
      status: "approved";
      accessToken: string;
      credentialId: string;
      projectId: string;
    };

export type SetupOptions = StorageOptions & {
  apiUrl?: string;
  installPlugin?: boolean;
  openBrowser?: boolean;
  runtimeDir?: string;
};

export type SetupDependencies = {
  fetch?: typeof fetch;
  installPlugin?: (runtimeDir: string, configDir: string) => Promise<void>;
  launchBrowser?: (url: string) => Promise<void>;
  output?: (message: string) => void;
  persistDataDirLocation?: (
    dataDir: string,
    options: StorageOptions,
  ) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedWebUrl(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  ) {
    throw new Error(`${label} must use HTTPS (or localhost HTTP)`);
  }
  return url.toString().replace(/\/$/, "");
}

function normalizedApiUrl(value: string): string {
  return normalizedWebUrl(value, "Lemma API URL");
}

async function jsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      isRecord(body) && typeof body.detail === "string"
        ? body.detail
        : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

async function startDeviceAuthorization(
  apiUrl: string,
  fetchImplementation: typeof fetch,
): Promise<DeviceAuthorization> {
  const body = await jsonResponse(
    await fetchImplementation(
      `${apiUrl}/coding-harness/device-authorizations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ harness: "opencode" }),
      },
    ),
  );
  if (
    !isRecord(body) ||
    typeof body.device_code !== "string" ||
    typeof body.user_code !== "string" ||
    typeof body.verification_uri_complete !== "string" ||
    typeof body.expires_in !== "number" ||
    typeof body.interval !== "number"
  ) {
    throw new Error("Lemma returned an invalid OpenCode device authorization");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUriComplete: normalizedWebUrl(
      body.verification_uri_complete,
      "Lemma verification URL",
    ),
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

async function pollDeviceAuthorization(
  apiUrl: string,
  deviceCode: string,
  fetchImplementation: typeof fetch,
): Promise<DeviceTokenResult> {
  const response = await fetchImplementation(
    `${apiUrl}/coding-harness/device-authorizations/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.status !== "string") {
    throw new Error(`Lemma OpenCode login failed with HTTP ${response.status}`);
  }
  switch (body.status) {
    case "authorization_pending":
    case "slow_down":
      return {
        status: body.status,
        interval: typeof body.interval === "number" ? body.interval : 5,
      };
    case "expired_token":
    case "access_denied":
      return { status: body.status };
    case "approved":
      if (
        typeof body.access_token !== "string" ||
        typeof body.credential_id !== "string" ||
        typeof body.project_id !== "string"
      ) {
        throw new Error("Lemma returned an invalid OpenCode scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id,
      };
    default:
      throw new Error(
        "Lemma returned an unknown OpenCode authorization status",
      );
  }
}

export async function launchBrowser(url: string): Promise<void> {
  const command = browserLaunchCommand(url);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

export function browserLaunchCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[] } {
  if (platform === "darwin") return { file: "/usr/bin/open", args: [url] };
  if (platform === "win32") {
    const systemRoot =
      env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
    const normalizedSystemRoot = systemRoot && win32.normalize(systemRoot);
    if (
      !normalizedSystemRoot ||
      !/^[A-Za-z]:\\Windows$/i.test(normalizedSystemRoot)
    ) {
      throw new Error(
        "Lemma could not resolve the trusted Windows browser launcher",
      );
    }
    return {
      file: win32.join(normalizedSystemRoot, "System32", "rundll32.exe"),
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { file: "/usr/bin/xdg-open", args: [url] };
}

export function packagedRuntimeDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../runtime");
}

export async function installGlobalPlugin(
  runtimeDir: string,
  configDir: string,
): Promise<void> {
  const destination = pluginPath({ configDir });
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const source = await readFile(join(runtimeDir, "lemma.mjs"), "utf8");
  if (!source.startsWith(MANAGED_PLUGIN_MARKER)) {
    throw new Error(
      "The bundled Lemma OpenCode plugin is missing its ownership marker",
    );
  }
  const existing = await lstat(destination).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `Refusing to replace symlinked plugin path: ${destination}`,
    );
  }
  if (existing) {
    const current = await readFile(destination, "utf8");
    if (!current.startsWith(MANAGED_PLUGIN_MARKER)) {
      throw new Error(`Refusing to replace an unowned plugin: ${destination}`);
    }
  }
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, source, { encoding: "utf8", mode: 0o600 });
  if (existing && process.platform === "win32") await unlink(destination);
  await rename(temporaryPath, destination);
  if (process.platform !== "win32") {
    await chmod(destination, 0o600);
  }
}

export async function runSetup(
  options: SetupOptions = {},
  dependencies: SetupDependencies = {},
): Promise<LemmaOpenCodeCredentials> {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const output = dependencies.output ?? console.log;
  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation,
  );
  output(
    `Authorize OpenCode for one Lemma project: ${authorization.verificationUriComplete}`,
  );
  output(`Device code: ${authorization.userCode}`);
  if (options.openBrowser !== false) {
    await (dependencies.launchBrowser ?? launchBrowser)(
      authorization.verificationUriComplete,
    );
  }
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, milliseconds),
      ));
  const deadline = Date.now() + authorization.expiresIn * 1_000;
  let interval = authorization.interval;
  while (Date.now() < deadline) {
    await sleep(interval * 1_000);
    const result = await pollDeviceAuthorization(
      apiUrl,
      authorization.deviceCode,
      fetchImplementation,
    );
    if (result.status === "authorization_pending") {
      interval = result.interval;
      continue;
    }
    if (result.status === "slow_down") {
      interval = result.interval;
      continue;
    }
    if (result.status === "expired_token")
      throw new Error("Lemma login expired");
    if (result.status === "access_denied")
      throw new Error("Lemma login was denied");
    const credentials: LemmaOpenCodeCredentials = {
      version: 1,
      apiUrl,
      projectId: result.projectId,
      credentialId: result.credentialId,
      accessToken: result.accessToken,
    };
    const dataDir = resolveDataDir(options);
    await writeCredentials(credentials, { ...options, dataDir });
    await (dependencies.persistDataDirLocation ?? writeDataDirLocation)(
      dataDir,
      options,
    );
    if (options.installPlugin !== false) {
      const configDir = resolveConfigDir(options);
      await (dependencies.installPlugin ?? installGlobalPlugin)(
        options.runtimeDir ?? packagedRuntimeDir(),
        configDir,
      );
      output(`Installed the Lemma plugin in ${join(configDir, "plugins")}`);
    }
    output("OpenCode is connected to the selected Lemma project.");
    return credentials;
  }
  throw new Error("Lemma login expired");
}
