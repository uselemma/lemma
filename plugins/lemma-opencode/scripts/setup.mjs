#!/usr/bin/env node

// src/setup.ts
import { spawn } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import {
  chmod as chmod2,
  lstat,
  mkdir as mkdir2,
  readFile as readFile2,
  rename as rename2,
  unlink as unlink2,
  writeFile as writeFile2
} from "node:fs/promises";
import { dirname as dirname2, join as join2, resolve as resolve2, win32 } from "node:path";
import { fileURLToPath } from "node:url";

// src/storage.ts
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var LEMMA_OPENCODE_CREDENTIALS_HELP = "Lemma OpenCode credentials are missing or invalid. Run `pnpm dlx @uselemma/opencode setup` to connect or rotate the scoped credential.";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && value.apiUrl.length > 0 && typeof value.projectId === "string" && value.projectId.length > 0 && typeof value.credentialId === "string" && value.credentialId.length > 0 && typeof value.accessToken === "string" && value.accessToken.length > 0;
}
function resolveConfigDir(options = {}) {
  if (options.configDir) return resolve(options.configDir);
  const env = options.env ?? process.env;
  const configured = env.OPENCODE_CONFIG_DIR?.trim();
  if (configured) return resolve(configured);
  const home = options.homeDir ?? homedir();
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome ? join(resolve(xdgConfigHome), "opencode") : join(resolve(home), ".config", "opencode");
}
function defaultDataDir(options) {
  return join(resolveConfigDir(options), "lemma");
}
function dataDirLocationPath(options) {
  return join(defaultDataDir(options), "data-dir-location.json");
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return resolve(options.dataDir);
  const env = options.env ?? process.env;
  const configured = env.LEMMA_OPENCODE_DATA_DIR?.trim();
  if (configured) return resolve(configured);
  const fallback = defaultDataDir(options);
  try {
    const value = JSON.parse(
      readFileSync(dataDirLocationPath(options), "utf8")
    );
    if (isRecord(value) && value.version === 1 && typeof value.dataDir === "string" && value.dataDir.trim().length > 0) {
      return resolve(value.dataDir);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return fallback;
}
function credentialsPath(options = {}) {
  return join(resolveDataDir(options), "credentials.json");
}
function pluginPath(options = {}) {
  return join(resolveConfigDir(options), "plugins", "uselemma-opencode.js");
}
async function writeSecureJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  if (process.platform !== "win32") await chmod(dirname(path), 448);
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
async function writeCredentials(credentials, options = {}) {
  if (!isCredentials(credentials)) {
    throw new Error(LEMMA_OPENCODE_CREDENTIALS_HELP);
  }
  await writeSecureJson(credentialsPath(options), credentials);
}
async function writeDataDirLocation(dataDir, options = {}) {
  const absolute = resolve(dataDir);
  const fallback = defaultDataDir(options);
  const locationPath = dataDirLocationPath(options);
  if (absolute === fallback) {
    await unlink(locationPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writeSecureJson(locationPath, { version: 1, dataDir: absolute });
}

// src/setup.ts
var DEFAULT_API_URL = "https://api.uselemma.ai";
var MANAGED_PLUGIN_MARKER = "// @uselemma/opencode managed plugin";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizedWebUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
    throw new Error(`${label} must use HTTPS (or localhost HTTP)`);
  }
  return url.toString().replace(/\/$/, "");
}
function normalizedApiUrl(value) {
  return normalizedWebUrl(value, "Lemma API URL");
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
  const body = await jsonResponse(
    await fetchImplementation(
      `${apiUrl}/coding-harness/device-authorizations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ harness: "opencode" })
      }
    )
  );
  if (!isRecord2(body) || typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri_complete !== "string" || typeof body.expires_in !== "number" || typeof body.interval !== "number") {
    throw new Error("Lemma returned an invalid OpenCode device authorization");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUriComplete: normalizedWebUrl(
      body.verification_uri_complete,
      "Lemma verification URL"
    ),
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
    throw new Error(`Lemma OpenCode login failed with HTTP ${response.status}`);
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
        throw new Error("Lemma returned an invalid OpenCode scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id
      };
    default:
      throw new Error(
        "Lemma returned an unknown OpenCode authorization status"
      );
  }
}
async function launchBrowser(url) {
  const command = browserLaunchCommand(url);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
function browserLaunchCommand(url, platform = process.platform, env = process.env) {
  if (platform === "darwin") return { file: "/usr/bin/open", args: [url] };
  if (platform === "win32") {
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
    const normalizedSystemRoot = systemRoot && win32.normalize(systemRoot);
    if (!normalizedSystemRoot || !/^[A-Za-z]:\\Windows$/i.test(normalizedSystemRoot)) {
      throw new Error(
        "Lemma could not resolve the trusted Windows browser launcher"
      );
    }
    return {
      file: win32.join(normalizedSystemRoot, "System32", "rundll32.exe"),
      args: ["url.dll,FileProtocolHandler", url]
    };
  }
  return { file: "/usr/bin/xdg-open", args: [url] };
}
function packagedRuntimeDir() {
  return resolve2(dirname2(fileURLToPath(import.meta.url)), "../runtime");
}
async function installGlobalPlugin(runtimeDir, configDir) {
  const destination = pluginPath({ configDir });
  await mkdir2(dirname2(destination), { recursive: true, mode: 448 });
  const source = await readFile2(join2(runtimeDir, "lemma.mjs"), "utf8");
  if (!source.startsWith(MANAGED_PLUGIN_MARKER)) {
    throw new Error(
      "The bundled Lemma OpenCode plugin is missing its ownership marker"
    );
  }
  const existing = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `Refusing to replace symlinked plugin path: ${destination}`
    );
  }
  if (existing) {
    const current = await readFile2(destination, "utf8");
    if (!current.startsWith(MANAGED_PLUGIN_MARKER)) {
      throw new Error(`Refusing to replace an unowned plugin: ${destination}`);
    }
  }
  const temporaryPath = `${destination}.${process.pid}.${randomUUID2()}.tmp`;
  await writeFile2(temporaryPath, source, { encoding: "utf8", mode: 384 });
  if (existing && process.platform === "win32") await unlink2(destination);
  await rename2(temporaryPath, destination);
  if (process.platform !== "win32") {
    await chmod2(destination, 384);
  }
}
async function runSetup(options = {}, dependencies = {}) {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const output = dependencies.output ?? console.log;
  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation
  );
  output(
    `Authorize OpenCode for one Lemma project: ${authorization.verificationUriComplete}`
  );
  output(`Device code: ${authorization.userCode}`);
  if (options.openBrowser !== false) {
    await (dependencies.launchBrowser ?? launchBrowser)(
      authorization.verificationUriComplete
    );
  }
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise(
    (resolvePromise) => setTimeout(resolvePromise, milliseconds)
  ));
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
      interval = result.interval;
      continue;
    }
    if (result.status === "expired_token")
      throw new Error("Lemma login expired");
    if (result.status === "access_denied")
      throw new Error("Lemma login was denied");
    const credentials = {
      version: 1,
      apiUrl,
      projectId: result.projectId,
      credentialId: result.credentialId,
      accessToken: result.accessToken
    };
    const dataDir = resolveDataDir(options);
    await writeCredentials(credentials, { ...options, dataDir });
    await (dependencies.persistDataDirLocation ?? writeDataDirLocation)(
      dataDir,
      options
    );
    if (options.installPlugin !== false) {
      const configDir = resolveConfigDir(options);
      await (dependencies.installPlugin ?? installGlobalPlugin)(
        options.runtimeDir ?? packagedRuntimeDir(),
        configDir
      );
      output(`Installed the Lemma plugin in ${join2(configDir, "plugins")}`);
    }
    output("OpenCode is connected to the selected Lemma project.");
    return credentials;
  }
  throw new Error("Lemma login expired");
}

// src/setup-entry.ts
function usage() {
  console.error(
    "Usage: lemma-opencode setup [--api-url URL] [--config-dir PATH] [--data-dir PATH] [--no-browser] [--skip-install]"
  );
  process.exit(2);
}
function parseOptions(args) {
  const options = {};
  const values = args[0] === "setup" ? args.slice(1) : args;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    switch (argument) {
      case "--api-url":
        options.apiUrl = values[index + 1] ?? usage();
        index += 1;
        break;
      case "--config-dir":
        options.configDir = values[index + 1] ?? usage();
        index += 1;
        break;
      case "--data-dir":
        options.dataDir = values[index + 1] ?? usage();
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
    `Lemma OpenCode setup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
