import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveDataDir,
  writeCredentials,
  writeDataDirLocation,
  type LemmaClaudeCodeCredentials,
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

export type CommandResult = {
  code: number;
  stdout: string;
  output: string;
};

export type RunCommand = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

export type SetupOptions = {
  apiUrl?: string;
  dataDir?: string;
  openBrowser?: boolean;
  installPlugin?: boolean;
  marketplaceRoot?: string;
};

export type SetupDependencies = {
  fetch?: typeof fetch;
  launchBrowser?: (url: string) => Promise<void>;
  installLocalPlugin?: (marketplaceRoot: string) => Promise<string>;
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
      body: JSON.stringify({ harness: "claude-code" }),
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

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      resolvePromise({ code: 1, stdout: "", output: error.message });
    });
    child.once("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      resolvePromise({
        code: code ?? 1,
        stdout: stdoutText,
        output: `${stdoutText}${stderrText}`,
      });
    });
  });
}

function parsedArray(stdout: string, label: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`Claude returned invalid ${label} JSON`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Claude returned invalid ${label} JSON`);
  }
  return value;
}

function localMarketplacePath(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  if (typeof entry.path === "string") return entry.path;
  if (
    typeof entry.installLocation === "string" &&
    entry.source === "directory"
  ) {
    return entry.installLocation;
  }
  return null;
}

function installedPluginPath(entries: unknown[]): string | null {
  for (const entry of entries) {
    if (
      isRecord(entry) &&
      entry.id === "lemma-claude-code@lemma-local" &&
      typeof entry.installPath === "string"
    ) {
      return entry.installPath;
    }
  }
  return null;
}

export async function installLocalPlugin(
  marketplaceRoot: string,
  runCommand: RunCommand = defaultRunCommand,
): Promise<string> {
  marketplaceRoot = resolve(marketplaceRoot);
  const addArgs = [
    "plugin",
    "marketplace",
    "add",
    marketplaceRoot,
    "--scope",
    "user",
  ];
  let add = await runCommand("claude", addArgs);
  if (add.code !== 0) {
    const listed = await runCommand("claude", [
      "plugin",
      "marketplace",
      "list",
      "--json",
    ]);
    if (listed.code !== 0) {
      throw new Error(
        `Could not inspect Claude marketplaces: ${listed.output}`,
      );
    }
    const current = parsedArray(listed.stdout, "marketplace").find(
      (entry) => isRecord(entry) && entry.name === "lemma-local",
    );
    const currentPath = localMarketplacePath(current);
    if (!current || !currentPath || resolve(currentPath) !== marketplaceRoot) {
      const remove = await runCommand("claude", [
        "plugin",
        "marketplace",
        "remove",
        "lemma-local",
      ]);
      if (remove.code !== 0) {
        throw new Error(
          `Could not replace the local Lemma marketplace: ${remove.output}`,
        );
      }
      add = await runCommand("claude", addArgs);
      if (add.code !== 0) {
        throw new Error(
          `Could not add the local Lemma marketplace: ${add.output}`,
        );
      }
    }
  }

  const installed = await runCommand("claude", ["plugin", "list", "--json"]);
  if (installed.code !== 0) {
    throw new Error(
      `Could not inspect installed Claude plugins: ${installed.output}`,
    );
  }
  if (installedPluginPath(parsedArray(installed.stdout, "plugin"))) {
    const uninstall = await runCommand("claude", [
      "plugin",
      "uninstall",
      "lemma-claude-code@lemma-local",
      "--scope",
      "user",
      "--keep-data",
    ]);
    if (uninstall.code !== 0) {
      throw new Error(
        `Could not refresh the Lemma Claude Code plugin: ${uninstall.output}`,
      );
    }
  }

  const install = await runCommand("claude", [
    "plugin",
    "install",
    "lemma-claude-code@lemma-local",
    "--scope",
    "user",
  ]);
  if (install.code !== 0) {
    throw new Error(
      `Could not install the Lemma Claude Code plugin: ${install.output}`,
    );
  }
  const refreshed = await runCommand("claude", ["plugin", "list", "--json"]);
  if (refreshed.code !== 0) {
    throw new Error(
      `Could not inspect the installed Claude plugin: ${refreshed.output}`,
    );
  }
  const installPath = installedPluginPath(
    parsedArray(refreshed.stdout, "plugin"),
  );
  if (!installPath) {
    throw new Error(
      "Claude did not report the Lemma Claude Code installation path",
    );
  }
  return resolve(installPath);
}

function inferredMarketplaceRoot(): string | null {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(pluginRoot, "..", "..");
  return existsSync(resolve(root, ".claude-plugin", "marketplace.json"))
    ? root
    : null;
}

export async function runSetup(
  options: SetupOptions = {},
  dependencies: SetupDependencies = {},
): Promise<LemmaClaudeCodeCredentials> {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const output = dependencies.output ?? console.log;
  const fetchImplementation = dependencies.fetch ?? fetch;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, milliseconds),
      ));

  if (options.installPlugin !== false) {
    const marketplaceRoot =
      options.marketplaceRoot ?? inferredMarketplaceRoot();
    if (marketplaceRoot) {
      output("Installing the local Lemma Claude Code plugin…");
      await (dependencies.installLocalPlugin ?? installLocalPlugin)(
        marketplaceRoot,
      );
    } else {
      output(
        "The Claude Code plugin is already installed; continuing with login.",
      );
    }
  }

  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation,
  );
  output(`Approve Lemma Claude Code with code ${authorization.userCode}`);
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
      throw new Error("Lemma Claude Code authorization was denied");
    }
    if (result.status === "expired_token") {
      throw new Error(
        "Lemma Claude Code authorization expired; run setup again",
      );
    }

    const credentials: LemmaClaudeCodeCredentials = {
      version: 1,
      apiUrl,
      projectId: result.projectId,
      credentialId: result.credentialId,
      accessToken: result.accessToken,
    };
    const dataDir = resolveDataDir({ dataDir: options.dataDir });
    await writeCredentials(dataDir, credentials);
    await (dependencies.persistDataDirLocation ?? writeDataDirLocation)(
      dataDir,
    );
    output(`Lemma Claude Code is connected to project ${result.projectId}.`);
    return credentials;
  }
  throw new Error("Lemma Claude Code authorization expired; run setup again");
}
