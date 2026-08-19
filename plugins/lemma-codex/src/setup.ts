import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

import {
  resolveDataDir,
  writeDataDirLocation,
  writeCredentials,
  writeNotifyForwarder,
  type LemmaCodexCredentials,
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
  marketplaceRoot?: string;
  codexHome?: string;
};

export type SetupDependencies = {
  fetch?: typeof fetch;
  launchBrowser?: (url: string) => Promise<void>;
  installLocalPlugin?: (marketplaceRoot: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  output?: (message: string) => void;
  persistDataDirLocation?: (dataDir: string) => Promise<void>;
  configureNotify?: (input: {
    dataDir: string;
    notifyRuntimePath: string;
    codexHome?: string;
  }) => Promise<void>;
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

function codexConfigPath(codexHome?: string): string {
  const root =
    codexHome || process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return join(resolve(root), "config.toml");
}

function notifyAssignmentRange(
  source: string,
): { start: number; end: number } | null {
  let offset = 0;
  let assignmentStart = -1;
  let equalsAt = -1;
  for (const line of source.match(/.*(?:\r?\n|$)/g) ?? []) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*notify\s*=/);
    if (match) {
      assignmentStart = offset;
      equalsAt = offset + match[0].lastIndexOf("=");
      break;
    }
    offset += line.length;
  }
  if (assignmentStart < 0 || equalsAt < 0) return null;

  let depth = 0;
  let foundArray = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let comment = false;
  for (let index = equalsAt + 1; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === "\n") comment = false;
      continue;
    }
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") {
      foundArray = true;
      depth += 1;
      continue;
    }
    if (character !== "]" || !foundArray) continue;
    depth -= 1;
    if (depth !== 0) continue;
    const newline = source.indexOf("\n", index);
    return {
      start: assignmentStart,
      end: newline < 0 ? source.length : newline + 1,
    };
  }
  throw new Error("Codex notify configuration is not a complete TOML array");
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isLemmaNotifier(command: string[]): boolean {
  const script = command[1]?.replaceAll("\\", "/");
  return script?.endsWith("/runtime/notify.mjs") === true;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}

export async function configureCodexNotify(input: {
  dataDir: string;
  notifyRuntimePath: string;
  codexHome?: string;
}): Promise<void> {
  const configPath = codexConfigPath(input.codexHome);
  const source = await readFile(configPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(source) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const current = parsed.notify;
  if (current !== undefined && !isStringArray(current)) {
    throw new Error("Codex notify must be an array of command strings");
  }

  const next = [process.execPath, resolve(input.notifyRuntimePath)];
  if (isStringArray(current) && current.length > 0 && isLemmaNotifier(current)) {
    if (current[0] === next[0] && resolve(current[1] ?? "") === next[1]) return;
  } else {
    await writeNotifyForwarder(input.dataDir, {
      version: 1,
      command: isStringArray(current) && current.length > 0 ? current : null,
    });
  }

  const assignment = `notify = ${tomlStringArray(next)}\n`;
  const range = notifyAssignmentRange(source);
  if (current !== undefined && !range) {
    throw new Error(
      "Codex notify uses an unsupported quoted or dotted key; configure it as a root `notify = [...]` assignment",
    );
  }
  const nextSource = range
    ? `${source.slice(0, range.start)}${assignment}${source.slice(range.end)}`
    : `${assignment}${source.length > 0 ? "\n" : ""}${source}`;
  await writePrivateFile(configPath, nextSource);
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
      body: JSON.stringify({ harness: "codex" }),
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
        throw new Error("Lemma returned an invalid credential response");
      }
      return {
        status: body.status,
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id,
      };
    default:
      throw new Error(`Lemma returned an unknown login status: ${body.status}`);
  }
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed: ${output}`));
    });
  });
}

export async function launchBrowser(url: string): Promise<void> {
  const command = browserCommand(process.platform, url);
  await runProcess(command.command, command.args);
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

async function commandOutput(
  command: string,
  args: string[],
): Promise<{ code: number; output: string; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) =>
      resolvePromise({ code: code ?? 1, output: `${stdout}${stderr}`, stdout }),
    );
  });
}

type CommandOutput = typeof commandOutput;

function parsedObject(output: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(output) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function marketplaceSource(output: string): string | null {
  const body = parsedObject(output);
  const marketplaces = body?.marketplaces;
  if (!Array.isArray(marketplaces)) return null;
  for (const marketplace of marketplaces) {
    if (!isRecord(marketplace) || marketplace.name !== "lemma-local") continue;
    if (isRecord(marketplace.marketplaceSource)) {
      const source = marketplace.marketplaceSource.source;
      if (typeof source === "string") return source;
    }
    return typeof marketplace.root === "string" ? marketplace.root : null;
  }
  return null;
}

function installedPluginMarketplaceSource(output: string): string | null {
  const body = parsedObject(output);
  const installed = body?.installed;
  if (!Array.isArray(installed)) return null;
  for (const plugin of installed) {
    if (
      !isRecord(plugin) ||
      plugin.pluginId !== "lemma-codex@lemma-local" ||
      !isRecord(plugin.marketplaceSource)
    ) {
      continue;
    }
    const source = plugin.marketplaceSource.source;
    return typeof source === "string" ? source : null;
  }
  return null;
}

function hasInstalledLemmaPlugin(output: string): boolean {
  const body = parsedObject(output);
  return (
    Array.isArray(body?.installed) &&
    body.installed.some(
      (plugin) =>
        isRecord(plugin) && plugin.pluginId === "lemma-codex@lemma-local",
    )
  );
}

function sameLocalPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

export async function installLocalPlugin(
  marketplaceRoot: string,
  runCommand: CommandOutput = commandOutput,
): Promise<void> {
  let marketplace = await runCommand("codex", [
    "plugin",
    "marketplace",
    "add",
    marketplaceRoot,
    "--json",
  ]);
  if (marketplace.code !== 0) {
    const list = await runCommand("codex", [
      "plugin",
      "marketplace",
      "list",
      "--json",
    ]);
    if (list.code !== 0) {
      throw new Error(
        `Could not add the local Lemma marketplace: ${marketplace.output}`,
      );
    }
    const existingSource = marketplaceSource(list.stdout);
    if (!existingSource) {
      throw new Error(
        `Could not add the local Lemma marketplace: ${marketplace.output}`,
      );
    }
    if (!sameLocalPath(existingSource, marketplaceRoot)) {
      const plugins = await runCommand("codex", ["plugin", "list", "--json"]);
      if (plugins.code !== 0) {
        throw new Error(
          `Could not inspect installed Codex plugins: ${plugins.output}`,
        );
      }
      if (hasInstalledLemmaPlugin(plugins.stdout)) {
        const removePlugin = await runCommand("codex", [
          "plugin",
          "remove",
          "lemma-codex@lemma-local",
          "--json",
        ]);
        if (removePlugin.code !== 0) {
          throw new Error(
            `Could not replace the local Lemma plugin: ${removePlugin.output}`,
          );
        }
      }
      const removeMarketplace = await runCommand("codex", [
        "plugin",
        "marketplace",
        "remove",
        "lemma-local",
        "--json",
      ]);
      if (removeMarketplace.code !== 0) {
        throw new Error(
          `Could not replace the local Lemma marketplace: ${removeMarketplace.output}`,
        );
      }
      marketplace = await runCommand("codex", [
        "plugin",
        "marketplace",
        "add",
        marketplaceRoot,
        "--json",
      ]);
      if (marketplace.code !== 0) {
        throw new Error(
          `Could not add the local Lemma marketplace: ${marketplace.output}`,
        );
      }
    }
  }

  const installed = await runCommand("codex", ["plugin", "list", "--json"]);
  if (installed.code !== 0) {
    throw new Error(
      `Could not inspect installed Codex plugins: ${installed.output}`,
    );
  }
  if (hasInstalledLemmaPlugin(installed.stdout)) {
    const source = installedPluginMarketplaceSource(installed.stdout);
    if (!source || !sameLocalPath(source, marketplaceRoot)) {
      throw new Error(
        "The installed Lemma Codex plugin does not belong to the configured local marketplace",
      );
    }
    const remove = await runCommand("codex", [
      "plugin",
      "remove",
      "lemma-codex@lemma-local",
      "--json",
    ]);
    if (remove.code !== 0) {
      throw new Error(
        `Could not refresh the Lemma Codex plugin: ${remove.output}`,
      );
    }
  }

  const install = await runCommand("codex", [
    "plugin",
    "add",
    "lemma-codex@lemma-local",
    "--json",
  ]);
  if (install.code !== 0) {
    throw new Error(
      `Could not install the Lemma Codex plugin: ${install.output}`,
    );
  }
}

function inferredMarketplaceRoot(): string | null {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(pluginRoot, "..", "..");
  return existsSync(resolve(root, ".agents", "plugins", "marketplace.json"))
    ? root
    : null;
}

function inferredNotifyRuntimePath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "runtime",
    "notify.mjs",
  );
}

export async function runSetup(
  options: SetupOptions = {},
  dependencies: SetupDependencies = {},
): Promise<LemmaCodexCredentials> {
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
      output("Installing the local Lemma Codex plugin…");
      await (dependencies.installLocalPlugin ?? installLocalPlugin)(
        marketplaceRoot,
      );
    } else {
      output("The plugin is already installed; continuing with login.");
    }
  }

  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation,
  );
  output(`Approve Lemma Codex with code ${authorization.userCode}`);
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
      throw new Error("Lemma Codex authorization was denied");
    }
    if (result.status === "expired_token") {
      throw new Error("Lemma Codex authorization expired; run setup again");
    }

    const credentials: LemmaCodexCredentials = {
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
    await (dependencies.configureNotify ?? configureCodexNotify)({
      dataDir,
      notifyRuntimePath: inferredNotifyRuntimePath(),
      codexHome: options.codexHome,
    });
    output(`Lemma Codex is connected to project ${result.projectId}.`);
    return credentials;
  }
  throw new Error("Lemma Codex authorization expired; run setup again");
}
