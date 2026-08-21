import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveDataDir,
  writeCredentials,
  writeDataDirLocation,
  type LemmaCursorCredentials,
} from "./storage.js";

const DEFAULT_API_URL = "https://api.uselemma.ai";

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

export type SetupOptions = {
  apiUrl?: string;
  dataDir?: string;
  openBrowser?: boolean;
  installPlugin?: boolean;
  pluginRoot?: string;
  localPluginsDir?: string;
};

export type SetupDependencies = {
  fetch?: typeof fetch;
  launchBrowser?: (url: string) => Promise<void>;
  installLocalPlugin?: (
    pluginRoot: string,
    localPluginsDir?: string,
  ) => Promise<string>;
  sleep?: (milliseconds: number) => Promise<void>;
  output?: (message: string) => void;
  persistDataDirLocation?: (dataDir: string) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedApiUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  ) {
    throw new Error("Lemma API URL must use HTTPS (or localhost HTTP)");
  }
  return url.toString().replace(/\/$/, "");
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
  const response = await fetchImplementation(
    `${apiUrl}/coding-harness/device-authorizations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ harness: "cursor" }),
    },
  );
  const body = await jsonResponse(response);
  if (
    !isRecord(body) ||
    typeof body.device_code !== "string" ||
    typeof body.user_code !== "string" ||
    typeof body.verification_uri_complete !== "string" ||
    typeof body.expires_in !== "number" ||
    typeof body.interval !== "number"
  ) {
    throw new Error("Lemma returned an invalid device authorization");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUriComplete: body.verification_uri_complete,
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
    throw new Error(`Lemma login failed with HTTP ${response.status}`);
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
        throw new Error("Lemma returned an invalid scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id,
      };
    default:
      throw new Error("Lemma returned an unknown authorization status");
  }
}

export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", url],
    };
  }
  return { command: "xdg-open", args: [url] };
}

async function launchBrowser(url: string): Promise<void> {
  const { command, args } = browserCommand(process.platform, url);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function defaultPluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultLocalPluginsDir(): string {
  return join(homedir(), ".cursor", "plugins", "local");
}

export async function installLocalPlugin(
  pluginRoot: string,
  localPluginsDir = defaultLocalPluginsDir(),
): Promise<string> {
  const source = resolve(pluginRoot);
  if (!existsSync(join(source, ".cursor-plugin", "plugin.json"))) {
    throw new Error(`Cursor plugin manifest is missing from ${source}`);
  }
  const destination = resolve(localPluginsDir, "lemma-cursor");
  await mkdir(dirname(destination), { recursive: true });
  const current = await lstat(destination).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (current?.isSymbolicLink()) {
    const target = resolve(dirname(destination), await readlink(destination));
    if (target === source) return destination;
  }
  if (current) await rm(destination, { recursive: true, force: true });
  await symlink(source, destination, process.platform === "win32" ? "junction" : "dir");
  return destination;
}

export async function runSetup(
  options: SetupOptions = {},
  dependencies: SetupDependencies = {},
): Promise<LemmaCursorCredentials> {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const output = dependencies.output ?? console.log;

  if (options.installPlugin !== false) {
    const pluginRoot = options.pluginRoot ?? defaultPluginRoot();
    output("Installing the local Lemma Cursor plugin…");
    const installedPath = await (
      dependencies.installLocalPlugin ?? installLocalPlugin
    )(pluginRoot, options.localPluginsDir);
    output(`Installed Lemma Cursor at ${installedPath}.`);
  }

  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation,
  );
  output(`Approve Lemma Cursor with code ${authorization.userCode}`);
  output(authorization.verificationUriComplete);
  if (options.openBrowser !== false) {
    try {
      await (dependencies.launchBrowser ?? launchBrowser)(
        authorization.verificationUriComplete,
      );
    } catch (error) {
      output(
        `Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

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
      interval = Math.max(interval, result.interval);
      continue;
    }
    if (result.status === "access_denied") {
      throw new Error("Lemma Cursor authorization was denied");
    }
    if (result.status === "expired_token") {
      throw new Error("Lemma Cursor authorization expired; run setup again");
    }

    const credentials: LemmaCursorCredentials = {
      version: 1,
      apiUrl,
      projectId: result.projectId,
      credentialId: result.credentialId,
      accessToken: result.accessToken,
    };
    const dataDir = resolveDataDir({ dataDir: options.dataDir });
    await writeCredentials(dataDir, credentials);
    await (dependencies.persistDataDirLocation ?? writeDataDirLocation)(dataDir);
    output(`Lemma Cursor is connected to project ${result.projectId}.`);
    return credentials;
  }
  throw new Error("Lemma Cursor authorization expired; run setup again");
}
