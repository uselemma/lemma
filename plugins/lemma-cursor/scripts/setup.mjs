// src/setup.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir as mkdir2,
  readlink,
  rm,
  symlink
} from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/storage.ts
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pathImplementation(options) {
  return (options.platform ?? process.platform) === "win32" ? win32 : posix;
}
function absoluteDataDir(value, options) {
  return pathImplementation(options).resolve(value);
}
function defaultDataDir(options) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const platformPath = pathImplementation(options);
  if (platform === "darwin") {
    return platformPath.join(
      home,
      "Library",
      "Application Support",
      "Lemma",
      "Cursor"
    );
  }
  if (platform === "win32") {
    return platformPath.join(
      env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || platformPath.join(home, "AppData", "Local"),
      "Lemma",
      "Cursor"
    );
  }
  return platformPath.join(
    env.XDG_STATE_HOME?.trim() || platformPath.join(home, ".local", "state"),
    "lemma",
    "cursor"
  );
}
function dataDirLocationPath(options) {
  return pathImplementation(options).join(
    defaultDataDir(options),
    "data-dir-location.json"
  );
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return absoluteDataDir(options.dataDir, options);
  const env = options.env ?? process.env;
  const override = env.LEMMA_CURSOR_DATA_DIR?.trim();
  if (override) return absoluteDataDir(override, options);
  const fallback = defaultDataDir(options);
  try {
    const value = JSON.parse(
      readFileSync(dataDirLocationPath(options), "utf8")
    );
    if (isRecord(value) && value.version === 1 && typeof value.dataDir === "string" && value.dataDir.trim().length > 0) {
      return absoluteDataDir(value.dataDir, options);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return fallback;
}
async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 448 });
  if (process.platform !== "win32") await chmod(path, 448);
}
async function writeSecureJson(path, value) {
  await ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  if (process.platform !== "win32") await chmod(temporaryPath, 384);
  await rename(temporaryPath, path);
  if (process.platform !== "win32") await chmod(path, 384);
}
function credentialsPath(dataDir) {
  return join(dataDir, "credentials.json");
}
async function writeCredentials(dataDir, credentials) {
  await writeSecureJson(credentialsPath(dataDir), credentials);
}
async function writeDataDirLocation(dataDir, options = {}) {
  const absolute = absoluteDataDir(dataDir, options);
  const fallback = defaultDataDir(options);
  const locationPath = dataDirLocationPath(options);
  if (absolute === fallback) {
    await unlink(locationPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writeSecureJson(locationPath, {
    version: 1,
    dataDir: absolute
  });
}

// src/setup.ts
var DEFAULT_API_URL = "https://api.uselemma.ai";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizedApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
    throw new Error("Lemma API URL must use HTTPS (or localhost HTTP)");
  }
  return url.toString().replace(/\/$/, "");
}
async function jsonResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isRecord2(body) && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}
async function startDeviceAuthorization(apiUrl, fetchImplementation) {
  const response = await fetchImplementation(
    `${apiUrl}/coding-harness/device-authorizations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ harness: "cursor" })
    }
  );
  const body = await jsonResponse(response);
  if (!isRecord2(body) || typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri_complete !== "string" || typeof body.expires_in !== "number" || typeof body.interval !== "number") {
    throw new Error("Lemma returned an invalid device authorization");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUriComplete: body.verification_uri_complete,
    expiresIn: body.expires_in,
    interval: body.interval
  };
}
async function pollDeviceAuthorization(apiUrl, deviceCode, fetchImplementation) {
  const response = await fetchImplementation(
    `${apiUrl}/coding-harness/device-authorizations/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode })
    }
  );
  const body = await response.json().catch(() => null);
  if (!isRecord2(body) || typeof body.status !== "string") {
    throw new Error(`Lemma login failed with HTTP ${response.status}`);
  }
  switch (body.status) {
    case "authorization_pending":
    case "slow_down":
      return {
        status: body.status,
        interval: typeof body.interval === "number" ? body.interval : 5
      };
    case "expired_token":
    case "access_denied":
      return { status: body.status };
    case "approved":
      if (typeof body.access_token !== "string" || typeof body.credential_id !== "string" || typeof body.project_id !== "string") {
        throw new Error("Lemma returned an invalid scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id
      };
    default:
      throw new Error("Lemma returned an unknown authorization status");
  }
}
function browserCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", url]
    };
  }
  return { command: "xdg-open", args: [url] };
}
async function launchBrowser(url) {
  const { command, args } = browserCommand(process.platform, url);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
function defaultPluginRoot() {
  return resolve(dirname2(fileURLToPath(import.meta.url)), "..");
}
function defaultLocalPluginsDir() {
  return join2(homedir2(), ".cursor", "plugins", "local");
}
async function installLocalPlugin(pluginRoot, localPluginsDir = defaultLocalPluginsDir()) {
  const source = resolve(pluginRoot);
  if (!existsSync(join2(source, ".cursor-plugin", "plugin.json"))) {
    throw new Error(`Cursor plugin manifest is missing from ${source}`);
  }
  const destination = resolve(localPluginsDir, "lemma-cursor");
  await mkdir2(dirname2(destination), { recursive: true });
  const current = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current?.isSymbolicLink()) {
    const target = resolve(dirname2(destination), await readlink(destination));
    if (target === source) return destination;
  }
  if (current) await rm(destination, { recursive: true, force: true });
  await symlink(source, destination, process.platform === "win32" ? "junction" : "dir");
  return destination;
}
async function runSetup(options = {}, dependencies = {}) {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const output = dependencies.output ?? console.log;
  if (options.installPlugin !== false) {
    const pluginRoot = options.pluginRoot ?? defaultPluginRoot();
    output("Installing the local Lemma Cursor plugin\u2026");
    const installedPath = await (dependencies.installLocalPlugin ?? installLocalPlugin)(pluginRoot, options.localPluginsDir);
    output(`Installed Lemma Cursor at ${installedPath}.`);
  }
  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation
  );
  output(`Approve Lemma Cursor with code ${authorization.userCode}`);
  output(authorization.verificationUriComplete);
  if (options.openBrowser !== false) {
    try {
      await (dependencies.launchBrowser ?? launchBrowser)(
        authorization.verificationUriComplete
      );
    } catch (error) {
      output(
        `Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const deadline = Date.now() + authorization.expiresIn * 1e3;
  let interval = authorization.interval;
  while (Date.now() < deadline) {
    await sleep(interval * 1e3);
    const result = await pollDeviceAuthorization(
      apiUrl,
      authorization.deviceCode,
      fetchImplementation
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
    const credentials = {
      version: 1,
      apiUrl,
      projectId: result.projectId,
      credentialId: result.credentialId,
      accessToken: result.accessToken
    };
    const dataDir = resolveDataDir({ dataDir: options.dataDir });
    await writeCredentials(dataDir, credentials);
    await (dependencies.persistDataDirLocation ?? writeDataDirLocation)(dataDir);
    output(`Lemma Cursor is connected to project ${result.projectId}.`);
    return credentials;
  }
  throw new Error("Lemma Cursor authorization expired; run setup again");
}

// src/setup-entry.ts
function usage() {
  console.error(
    "Usage: node scripts/setup.mjs [--api-url URL] [--data-dir PATH] [--no-browser] [--skip-install]"
  );
  process.exit(2);
}
function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--api-url":
        options.apiUrl = args[index + 1] ?? usage();
        index += 1;
        break;
      case "--data-dir":
        options.dataDir = args[index + 1] ?? usage();
        index += 1;
        break;
      case "--no-browser":
        options.openBrowser = false;
        break;
      case "--skip-install":
        options.installPlugin = false;
        break;
      default:
        usage();
    }
  }
  return options;
}
try {
  await runSetup(parseOptions(process.argv.slice(2)));
} catch (error) {
  console.error(
    `Lemma Cursor setup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
