import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveDataDir,
  resolveOpenClawStateDir,
  writeCredentials,
  writeDataDirLocation,
  type LemmaOpenClawCredentials,
  type StorageOptions,
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

export type SetupOptions = StorageOptions & {
  apiUrl?: string;
  openBrowser?: boolean;
  installPlugin?: boolean;
  pluginRoot?: string;
};

export type SetupDependencies = {
  fetch?: typeof fetch;
  launchBrowser?: (url: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  output?: (message: string) => void;
  installPlugin?: (source: string, stateDir: string) => Promise<void>;
  configurePlugin?: (stateDir: string) => Promise<void>;
  persistDataDirLocation?: (
    dataDir: string,
    options: StorageOptions,
  ) => Promise<void>;
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
  const body = await jsonResponse(
    await fetchImplementation(
      `${apiUrl}/coding-harness/device-authorizations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ harness: "openclaw" }),
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
    throw new Error("Lemma returned an invalid OpenClaw device authorization");
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
    throw new Error(`Lemma OpenClaw login failed with HTTP ${response.status}`);
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
        throw new Error("Lemma returned an invalid OpenClaw scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id,
      };
    default:
      throw new Error("Lemma returned an unknown OpenClaw authorization status");
  }
}

async function launchBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  await runCommand(command.file, command.args, process.env, false);
}

function packagedPluginRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function runCommand(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  inheritOutput = true,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(file, args, {
      env,
      stdio: inheritOutput ? "inherit" : "ignore",
    });
    child.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "OpenClaw CLI was not found. Install OpenClaw and ensure `openclaw` is on PATH, then run setup again.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`OpenClaw command failed: ${file} ${args.join(" ")}`));
    });
  });
}

function openClawEnvironment(stateDir: string): NodeJS.ProcessEnv {
  return { ...process.env, OPENCLAW_STATE_DIR: stateDir };
}

export async function installOpenClawPlugin(
  source: string,
  stateDir: string,
): Promise<void> {
  await runCommand(
    "openclaw",
    ["plugins", "install", source, "--force"],
    openClawEnvironment(stateDir),
  );
}

export async function configureOpenClawPlugin(
  stateDir: string,
): Promise<void> {
  await runCommand(
    "openclaw",
    [
      "config",
      "set",
      "plugins.entries.lemma.hooks.allowConversationAccess",
      "true",
      "--strict-json",
    ],
    openClawEnvironment(stateDir),
  );
}

export async function runSetup(
  options: SetupOptions = {},
  dependencies: SetupDependencies = {},
): Promise<LemmaOpenClawCredentials> {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const output = dependencies.output ?? console.log;
  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation,
  );
  output(
    `Authorize OpenClaw for one Lemma project: ${authorization.verificationUriComplete}`,
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
    if (result.status === "expired_token") {
      throw new Error("Lemma login expired");
    }
    if (result.status === "access_denied") {
      throw new Error("Lemma login was denied");
    }
    const credentials: LemmaOpenClawCredentials = {
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
      const stateDir = resolveOpenClawStateDir(options);
      await (dependencies.installPlugin ?? installOpenClawPlugin)(
        options.pluginRoot ?? packagedPluginRoot(),
        stateDir,
      );
      await (dependencies.configurePlugin ?? configureOpenClawPlugin)(stateDir);
      output(`Installed and enabled the Lemma plugin in ${stateDir}`);
    }
    output("OpenClaw is connected to the selected Lemma project.");
    return credentials;
  }
  throw new Error("Lemma login expired");
}
