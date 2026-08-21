#!/usr/bin/env node

// src/setup.ts
import { spawn } from "node:child_process";
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/storage.ts
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var LEMMA_OPENCLAW_CREDENTIALS_HELP = "Lemma OpenClaw credentials are missing or invalid. Run `pnpm dlx @uselemma/openclaw setup` to connect or rotate the scoped credential.";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && value.apiUrl.length > 0 && typeof value.projectId === "string" && value.projectId.length > 0 && typeof value.credentialId === "string" && value.credentialId.length > 0 && typeof value.accessToken === "string" && value.accessToken.length > 0;
}
function resolveOpenClawStateDir(options = {}) {
  if (options.stateDir) return resolve(options.stateDir);
  const env = options.env ?? process.env;
  const configured = env.OPENCLAW_STATE_DIR?.trim();
  if (configured) return resolve(configured);
  const home = env.OPENCLAW_HOME?.trim() || options.homeDir || homedir();
  const current = join(resolve(home), ".openclaw");
  const legacy = join(resolve(home), ".clawdbot");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}
function defaultDataDir(options) {
  return join(resolveOpenClawStateDir(options), "lemma");
}
function dataDirLocationPath(options) {
  return join(defaultDataDir(options), "data-dir-location.json");
}
function resolveDataDir(options = {}) {
  if (options.dataDir) return resolve(options.dataDir);
  const env = options.env ?? process.env;
  const configured = env.LEMMA_OPENCLAW_DATA_DIR?.trim();
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
    throw new Error(LEMMA_OPENCLAW_CREDENTIALS_HELP);
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
  const body = await jsonResponse(
    await fetchImplementation(
      `${apiUrl}/coding-harness/device-authorizations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ harness: "openclaw" })
      }
    )
  );
  if (!isRecord2(body) || typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri_complete !== "string" || typeof body.expires_in !== "number" || typeof body.interval !== "number") {
    throw new Error("Lemma returned an invalid OpenClaw device authorization");
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
    throw new Error(`Lemma OpenClaw login failed with HTTP ${response.status}`);
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
        throw new Error("Lemma returned an invalid OpenClaw scoped credential");
      }
      return {
        status: "approved",
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id
      };
    default:
      throw new Error("Lemma returned an unknown OpenClaw authorization status");
  }
}
async function launchBrowser(url) {
  const command = process.platform === "darwin" ? { file: "open", args: [url] } : process.platform === "win32" ? { file: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] } : { file: "xdg-open", args: [url] };
  await runCommand(command.file, command.args, process.env, false);
}
function packagedPluginRoot() {
  return resolve2(dirname2(fileURLToPath(import.meta.url)), "..");
}
async function runCommand(file, args, env, inheritOutput = true) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      env,
      stdio: inheritOutput ? "inherit" : "ignore"
    });
    child.once("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "OpenClaw CLI was not found. Install OpenClaw and ensure `openclaw` is on PATH, then run setup again."
          )
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
function openClawEnvironment(stateDir) {
  return { ...process.env, OPENCLAW_STATE_DIR: stateDir };
}
async function installOpenClawPlugin(source, stateDir) {
  await runCommand(
    "openclaw",
    ["plugins", "install", source, "--force"],
    openClawEnvironment(stateDir)
  );
}
async function configureOpenClawPlugin(stateDir) {
  await runCommand(
    "openclaw",
    [
      "config",
      "set",
      "plugins.entries.lemma.hooks.allowConversationAccess",
      "true",
      "--strict-json"
    ],
    openClawEnvironment(stateDir)
  );
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
    `Authorize OpenClaw for one Lemma project: ${authorization.verificationUriComplete}`
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
    if (result.status === "expired_token") {
      throw new Error("Lemma login expired");
    }
    if (result.status === "access_denied") {
      throw new Error("Lemma login was denied");
    }
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
      const stateDir = resolveOpenClawStateDir(options);
      await (dependencies.installPlugin ?? installOpenClawPlugin)(
        options.pluginRoot ?? packagedPluginRoot(),
        stateDir
      );
      await (dependencies.configurePlugin ?? configureOpenClawPlugin)(stateDir);
      output(`Installed and enabled the Lemma plugin in ${stateDir}`);
    }
    output("OpenClaw is connected to the selected Lemma project.");
    return credentials;
  }
  throw new Error("Lemma login expired");
}

// src/setup-entry.ts
function usage() {
  console.error(
    "Usage: lemma-openclaw setup [--api-url URL] [--data-dir PATH] [--state-dir PATH] [--no-browser] [--skip-install]"
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
      case "--data-dir":
        options.dataDir = values[index + 1] ?? usage();
        index += 1;
        break;
      case "--state-dir":
        options.stateDir = values[index + 1] ?? usage();
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
    `Lemma OpenClaw setup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
