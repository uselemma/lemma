// src/hook-entry.ts
import { spawn } from "node:child_process";
import { dirname as dirname2, resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

// ../../packages/ts/tracing/src/error-message.ts
function errorMessage(error) {
  if (error == null) return null;
  if (error instanceof Error) {
    return qualify(errorClassName(error), error.message);
  }
  if (typeof error === "string") {
    return error.trim() || null;
  }
  if (typeof error === "object") {
    const record = error;
    if (typeof record.message === "string") {
      return qualify(
        typeof record.name === "string" ? record.name : void 0,
        record.message
      );
    }
    return stringifyObject(error);
  }
  return safeText(error) || null;
}
function describeError(error) {
  return errorMessage(error) ?? GENERIC_ERROR_NAME;
}
function failureMessage(error) {
  return error == null ? null : describeError(error);
}
function errorClassName(error) {
  const name = typeof error.name === "string" ? error.name : void 0;
  if (name && name !== GENERIC_ERROR_NAME) return name;
  const constructorName = error.constructor?.name;
  return (typeof constructorName === "string" ? constructorName : void 0) || name || GENERIC_ERROR_NAME;
}
function qualify(name, message) {
  const trimmedName = name?.trim();
  const trimmedMessage = messageText(message);
  if (!trimmedMessage) return trimmedName || GENERIC_ERROR_NAME;
  if (!trimmedName || trimmedName === GENERIC_ERROR_NAME || trimmedMessage.startsWith(`${trimmedName}:`)) {
    return trimmedMessage;
  }
  return `${trimmedName}: ${trimmedMessage}`;
}
function messageText(message) {
  if (typeof message === "string") return message.trim();
  if (message == null) return "";
  if (typeof message === "object") {
    const text = stringifyObject(message);
    return text === GENERIC_ERROR_NAME ? "" : text;
  }
  return safeText(message);
}
function stringifyObject(error) {
  try {
    const json = JSON.stringify(error);
    if (json && json !== "{}") return json;
  } catch {
  }
  const text = safeText(error);
  return text && text !== "[object Object]" ? text : GENERIC_ERROR_NAME;
}
function safeText(value) {
  try {
    return String(value).trim();
  } catch {
    return "";
  }
}
var GENERIC_ERROR_NAME = "Error";

// ../../packages/ts/tracing/src/coding-agent.ts
import { createHash } from "node:crypto";
function requireOpen(turn) {
  if (turn.status === "completed") {
    throw new Error(
      `Coding agent turn ${turn.sessionId}/${turn.turnId} already completed`
    );
  }
  return turn;
}
function deterministicUuid(value) {
  const hash = createHash("sha256").update(value).digest("hex");
  const variant = (8 + Number.parseInt(hash[16], 16) % 4).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function turnIdentity(options) {
  return `${options.harness}\0${options.sessionId}\0${options.turnId}`;
}
function startCodingAgentTurn(options) {
  return {
    version: 1,
    status: "open",
    harness: options.harness,
    sessionId: options.sessionId,
    turnId: options.turnId,
    traceId: options.traceId ?? deterministicUuid(`lemma-coding-agent-trace\0${turnIdentity(options)}`),
    generationId: options.generationId ?? deterministicUuid(
      `lemma-coding-agent-generation\0${turnIdentity(options)}`
    ),
    prompt: options.prompt,
    startedAt: options.startedAt,
    model: options.model,
    provider: options.provider,
    metadata: options.metadata,
    tools: []
  };
}
function recordCodingAgentToolStart(turn, event) {
  const open = requireOpen(turn);
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId
  );
  if (existingIndex >= 0) {
    const existing = open.tools[existingIndex];
    if (!existing.startTimeMissing) return open;
    const tools = [...open.tools];
    tools[existingIndex] = {
      ...existing,
      toolName: event.toolName,
      input: event.input === void 0 ? existing.input : event.input,
      startedAt: event.startedAt,
      startTimeMissing: void 0
    };
    return { ...open, tools };
  }
  return {
    ...open,
    tools: [
      ...open.tools,
      {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input,
        startedAt: event.startedAt
      }
    ]
  };
}
function recordCodingAgentToolResult(turn, event) {
  const open = requireOpen(turn);
  const existingIndex = open.tools.findIndex(
    (tool) => tool.toolUseId === event.toolUseId
  );
  const completed = {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    input: event.input === void 0 && existingIndex >= 0 ? open.tools[existingIndex].input : event.input,
    output: event.output,
    error: failureMessage(event.error) ?? void 0,
    startedAt: existingIndex >= 0 ? open.tools[existingIndex].startedAt : void 0,
    endedAt: event.endedAt,
    startTimeMissing: existingIndex >= 0 ? open.tools[existingIndex].startTimeMissing : true
  };
  if (existingIndex < 0) {
    return { ...open, tools: [...open.tools, completed] };
  }
  const tools = [...open.tools];
  tools[existingIndex] = completed;
  return { ...open, tools };
}
function completeCodingAgentTurn(turn, event) {
  if (turn.status === "completed") return turn;
  if (event.generationStartedAt === void 0 !== (event.generationEndedAt === void 0)) {
    throw new Error(
      "Coding agent generation timing requires both startedAt and endedAt"
    );
  }
  const tools = turn.tools.map((tool) => {
    const error = failureMessage(tool.error) ?? void 0;
    return tool.endedAt ? { ...tool, error } : { ...tool, error, resultMissing: true };
  });
  return {
    ...turn,
    tools,
    status: "completed",
    response: event.response,
    endedAt: event.endedAt,
    model: event.model ?? turn.model,
    provider: event.provider ?? turn.provider,
    generationStartedAt: event.generationStartedAt,
    generationEndedAt: event.generationEndedAt
  };
}

// src/storage.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
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
function safeId(value) {
  return createHash2("sha256").update(value).digest("hex");
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
      "Claude Code"
    );
  }
  if (platform === "win32") {
    return platformPath.join(
      env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || platformPath.join(home, "AppData", "Local"),
      "Lemma",
      "Claude Code"
    );
  }
  return platformPath.join(
    env.XDG_STATE_HOME?.trim() || platformPath.join(home, ".local", "state"),
    "lemma",
    "claude-code"
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
  const override = env.LEMMA_CLAUDE_CODE_DATA_DIR?.trim();
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
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && typeof value.projectId === "string" && typeof value.credentialId === "string" && typeof value.accessToken === "string";
}
function isCodingAgentTurn(value) {
  return isRecord(value) && value.version === 1 && (value.status === "open" || value.status === "completed") && value.harness === "claude-code" && typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.traceId === "string" && typeof value.generationId === "string" && typeof value.prompt === "string" && typeof value.startedAt === "string" && Array.isArray(value.tools) && (value.status === "open" || typeof value.response === "string" && typeof value.endedAt === "string");
}
function isStagedPrompt(value) {
  return isRecord(value) && value.version === 1 && typeof value.sessionId === "string" && typeof value.prompt === "string" && typeof value.startedAt === "string" && (value.model === void 0 || typeof value.model === "string") && (value.metadata === void 0 || isRecord(value.metadata));
}
function isPendingTurn(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && typeof value.projectId === "string" && typeof value.deliveryId === "string" && isCodingAgentTurn(value.turn) && value.turn.status === "completed";
}
function credentialsPath(dataDir) {
  return join(dataDir, "credentials.json");
}
function stagedPromptPath(dataDir, sessionId) {
  return join(dataDir, "staged", `${safeId(sessionId)}.json`);
}
function turnPath(dataDir, sessionId, turnId) {
  return join(dataDir, "turns", `${safeId(`${sessionId}\0${turnId}`)}.json`);
}
function pendingPath(dataDir, traceId) {
  return join(dataDir, "pending", `${safeId(traceId)}.json`);
}
async function readCredentials(dataDir) {
  const value = await readJson(credentialsPath(dataDir));
  if (value === null) return null;
  if (!isCredentials(value)) {
    throw new Error("Lemma Claude Code credentials are invalid");
  }
  return value;
}
async function readStagedPrompt(dataDir, sessionId) {
  const value = await readJson(stagedPromptPath(dataDir, sessionId));
  if (value === null) return null;
  if (!isStagedPrompt(value)) {
    throw new Error("Lemma Claude Code staged prompt is invalid");
  }
  return value;
}
async function writeStagedPrompt(dataDir, prompt) {
  await writeSecureJson(stagedPromptPath(dataDir, prompt.sessionId), prompt);
}
async function removeStagedPrompt(dataDir, sessionId) {
  await unlink(stagedPromptPath(dataDir, sessionId)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
async function readTurn(dataDir, sessionId, turnId) {
  const value = await readJson(turnPath(dataDir, sessionId, turnId));
  if (value === null) return null;
  if (!isCodingAgentTurn(value)) {
    throw new Error("Lemma Claude Code turn state is invalid");
  }
  return value;
}
async function writeTurn(dataDir, turn) {
  await writeSecureJson(turnPath(dataDir, turn.sessionId, turn.turnId), turn);
}
async function queueCompletedTurn(dataDir, turn, destination) {
  const path = pendingPath(dataDir, turn.traceId);
  const existing = await readJson(path);
  if (existing !== null) {
    if (!isPendingTurn(existing)) {
      throw new Error("Lemma Claude Code pending turn is invalid");
    }
    return;
  }
  await writeSecureJson(path, {
    version: 1,
    apiUrl: destination.apiUrl,
    projectId: destination.projectId,
    turn,
    deliveryId: randomUUID()
  });
}
function sleep2(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}
async function withSessionLock(dataDir, sessionId, callback) {
  const lockDirectory = join(dataDir, "locks", `${safeId(sessionId)}.lock`);
  await ensurePrivateDirectory(dirname(lockDirectory));
  const deadline = Date.now() + 2e3;
  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 448 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lockStat = await stat(lockDirectory).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 3e4) {
        await rmdir(lockDirectory).catch(() => void 0);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for Lemma Claude Code turn state lock"
        );
      }
      await sleep2(20);
    }
  }
  try {
    return await callback();
  } finally {
    await rmdir(lockDirectory).catch(() => void 0);
  }
}

// src/hook-handler.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(input, name) {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function eventName(input) {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "Stop":
      return input.hook_event_name;
    default:
      return null;
  }
}
function eventTimestamp(input, now) {
  const supplied = stringField(input, "timestamp");
  if (supplied && !Number.isNaN(Date.parse(supplied))) {
    return new Date(supplied).toISOString();
  }
  return now().toISOString();
}
function turnMetadata(input) {
  return {
    ...stringField(input, "cwd") ? { "lemma.harness.cwd": stringField(input, "cwd") } : {},
    ...stringField(input, "transcript_path") ? {
      "lemma.harness.transcript_path": stringField(
        input,
        "transcript_path"
      )
    } : {}
  };
}
function toolError(input) {
  if (input.error !== void 0) return input.error;
  if (input.is_error === true) return input.tool_response ?? "Tool failed";
  if (!isRecord2(input.tool_response)) return void 0;
  if (input.tool_response.error !== void 0) return input.tool_response.error;
  const exitCode = input.tool_response.exit_code;
  return typeof exitCode === "number" && exitCode !== 0 ? `Process exited with code ${exitCode}` : void 0;
}
function mergeMetadata(first, second) {
  const merged = { ...first ?? {}, ...second ?? {} };
  return Object.keys(merged).length > 0 ? merged : void 0;
}
async function materializeTurn(dataDir, sessionId, promptId, input, now) {
  const existing = await readTurn(dataDir, sessionId, promptId);
  if (existing) return existing;
  const staged = await readStagedPrompt(dataDir, sessionId);
  const directPrompt = stringField(input, "prompt");
  if (!staged && !directPrompt) return null;
  const source = staged ?? {
    version: 1,
    sessionId,
    prompt: directPrompt ?? "",
    startedAt: eventTimestamp(input, now),
    model: stringField(input, "model"),
    metadata: turnMetadata(input)
  };
  const turn = startCodingAgentTurn({
    harness: "claude-code",
    sessionId,
    turnId: promptId,
    prompt: source.prompt,
    startedAt: source.startedAt,
    model: source.model ?? stringField(input, "model"),
    provider: "anthropic",
    metadata: mergeMetadata(source.metadata, turnMetadata(input))
  });
  await writeTurn(dataDir, turn);
  if (staged) await removeStagedPrompt(dataDir, sessionId);
  return turn;
}
async function handleClaudeHook(input, dependencies = {}) {
  const event = eventName(input);
  const sessionId = stringField(input, "session_id");
  if (!event || !sessionId) return { status: "ignored" };
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  if (event === "UserPromptSubmit") {
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    const promptId2 = stringField(input, "prompt_id");
    await withSessionLock(dataDir, sessionId, async () => {
      if (promptId2) {
        await writeTurn(
          dataDir,
          startCodingAgentTurn({
            harness: "claude-code",
            sessionId,
            turnId: promptId2,
            prompt,
            startedAt: eventTimestamp(input, now),
            model: stringField(input, "model"),
            provider: "anthropic",
            metadata: turnMetadata(input)
          })
        );
        return;
      }
      await writeStagedPrompt(dataDir, {
        version: 1,
        sessionId,
        prompt,
        startedAt: eventTimestamp(input, now),
        model: stringField(input, "model"),
        metadata: turnMetadata(input)
      });
    });
    return { status: "recorded", event };
  }
  const promptId = stringField(input, "prompt_id");
  if (!promptId) return { status: "ignored" };
  if (event === "PreToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await materializeTurn(
        dataDir,
        sessionId,
        promptId,
        input,
        now
      );
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolStart(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          startedAt: eventTimestamp(input, now)
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "PostToolUse" || event === "PostToolUseFailure") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await materializeTurn(
        dataDir,
        sessionId,
        promptId,
        input,
        now
      );
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(turn, {
          toolUseId,
          toolName,
          input: input.tool_input,
          output: input.tool_response,
          error: toolError(input),
          endedAt: eventTimestamp(input, now)
        })
      );
    });
    return { status: "recorded", event };
  }
  const credentials = await readCredentials(dataDir);
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Claude Code did not queue the completed prompt because setup is incomplete"
    );
    return { status: "ignored" };
  }
  const traceId = await withSessionLock(dataDir, sessionId, async () => {
    const turn = await materializeTurn(
      dataDir,
      sessionId,
      promptId,
      input,
      now
    );
    if (!turn) return null;
    const completed = turn.status === "completed" ? turn : completeCodingAgentTurn(turn, {
      response: stringField(input, "last_assistant_message") ?? "",
      endedAt: eventTimestamp(input, now),
      model: stringField(input, "model"),
      provider: "anthropic"
    });
    if (turn.status === "open") await writeTurn(dataDir, completed);
    await queueCompletedTurn(dataDir, completed, credentials);
    return completed.traceId;
  });
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}

// src/hook-entry.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function scheduleTraceDelivery() {
  const flushEntry = resolve(
    dirname2(fileURLToPath(import.meta.url)),
    "flush.mjs"
  );
  const child = spawn(process.execPath, [flushEntry], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
}
async function main() {
  try {
    delete process.env.LEMMA_DEBUG;
    delete process.env.LEMMA_DEBUG_VERIFY;
    const input = JSON.parse(await readStdin());
    const result = await handleClaudeHook(input, {
      warn: (message) => stderr.write(`${message}
`)
    });
    if (result.status === "queued" || result.status === "recorded" && result.event === "UserPromptSubmit") {
      scheduleTraceDelivery();
    }
  } catch (error) {
    stderr.write(
      `Lemma Claude Code hook failed open: ${error instanceof Error ? error.message : String(error)}
`
    );
  }
  stdout.write("{}\n");
}
await main();
