// src/setup.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname as dirname2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/storage.ts
import { createHash, randomUUID } from "node:crypto";
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
function resolveDataDir(options = {}) {
  if (options.dataDir) return options.dataDir;
  const env = options.env ?? process.env;
  const override = env.LEMMA_CODEX_DATA_DIR?.trim();
  if (override) return override;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const platformPath = platform === "win32" ? win32 : posix;
  if (platform === "darwin") {
    return platformPath.join(
      home,
      "Library",
      "Application Support",
      "Lemma",
      "Codex"
    );
  }
  if (platform === "win32") {
    return platformPath.join(
      env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || platformPath.join(home, "AppData", "Local"),
      "Lemma",
      "Codex"
    );
  }
  return platformPath.join(
    env.XDG_STATE_HOME?.trim() || platformPath.join(home, ".local", "state"),
    "lemma",
    "codex"
  );
}
async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 448 });
  if (process.platform !== "win32") await chmod(path, 448);
}
async function writeSecureJson(path, value) {
  const parent = dirname(path);
  await ensurePrivateDirectory(parent);
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

// src/setup.ts
var DEFAULT_API_URL = "https://api.uselemma.ai";
function isRecord(value) {
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
    const detail = isRecord(body) && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
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
      body: JSON.stringify({ harness: "codex" })
    }
  );
  const body = await jsonResponse(response);
  if (!isRecord(body) || typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof body.verification_uri_complete !== "string" || typeof body.expires_in !== "number" || typeof body.interval !== "number") {
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
  if (!isRecord(body) || typeof body.status !== "string") {
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
        throw new Error("Lemma returned an invalid credential response");
      }
      return {
        status: body.status,
        accessToken: body.access_token,
        credentialId: body.credential_id,
        projectId: body.project_id
      };
    default:
      throw new Error(`Lemma returned an unknown login status: ${body.status}`);
  }
}
function runProcess(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed: ${output}`));
    });
  });
}
async function launchBrowser(url) {
  const command = browserCommand(process.platform, url);
  await runProcess(command.command, command.args);
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
async function commandOutput(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}
async function installLocalPlugin(marketplaceRoot) {
  const marketplace = await commandOutput("codex", [
    "plugin",
    "marketplace",
    "add",
    marketplaceRoot,
    "--json"
  ]);
  if (marketplace.code !== 0) {
    const list = await commandOutput("codex", [
      "plugin",
      "marketplace",
      "list"
    ]);
    if (list.code !== 0 || !list.output.includes("lemma-local")) {
      throw new Error(
        `Could not add the local Lemma marketplace: ${marketplace.output}`
      );
    }
  }
  const install = await commandOutput("codex", [
    "plugin",
    "add",
    "lemma-codex@lemma-local",
    "--json"
  ]);
  if (install.code !== 0) {
    const list = await commandOutput("codex", ["plugin", "list", "--json"]);
    if (list.code !== 0 || !list.output.includes("lemma-codex")) {
      throw new Error(
        `Could not install the Lemma Codex plugin: ${install.output}`
      );
    }
  }
}
function inferredMarketplaceRoot() {
  const pluginRoot = resolve(dirname2(fileURLToPath(import.meta.url)), "..");
  const root = resolve(pluginRoot, "..", "..");
  return existsSync(resolve(root, ".agents", "plugins", "marketplace.json")) ? root : null;
}
async function runSetup(options = {}, dependencies = {}) {
  const apiUrl = normalizedApiUrl(options.apiUrl ?? DEFAULT_API_URL);
  const output = dependencies.output ?? console.log;
  const fetchImplementation = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise(
    (resolvePromise) => setTimeout(resolvePromise, milliseconds)
  ));
  if (options.installPlugin !== false) {
    const marketplaceRoot = options.marketplaceRoot ?? inferredMarketplaceRoot();
    if (marketplaceRoot) {
      output("Installing the local Lemma Codex plugin\u2026");
      await (dependencies.installLocalPlugin ?? installLocalPlugin)(
        marketplaceRoot
      );
    } else {
      output("The plugin is already installed; continuing with login.");
    }
  }
  const authorization = await startDeviceAuthorization(
    apiUrl,
    fetchImplementation
  );
  output(`Approve Lemma Codex with code ${authorization.userCode}`);
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
      throw new Error("Lemma Codex authorization was denied");
    }
    if (result.status === "expired_token") {
      throw new Error("Lemma Codex authorization expired; run setup again");
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
    output(`Lemma Codex is connected to project ${result.projectId}.`);
    return credentials;
  }
  throw new Error("Lemma Codex authorization expired; run setup again");
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
    `Lemma Codex setup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
