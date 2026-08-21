// src/hook-entry.ts
import { spawn } from "node:child_process";
import { dirname as dirname2, resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

// src/hook-handler.ts
import { readFile as readFile2 } from "node:fs/promises";

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
  return isRecord(value) && value.version === 1 && (value.status === "open" || value.status === "completed") && value.harness === "cursor" && typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.traceId === "string" && typeof value.generationId === "string" && typeof value.prompt === "string" && typeof value.startedAt === "string" && Array.isArray(value.tools) && (value.status === "open" || typeof value.response === "string" && typeof value.endedAt === "string");
}
function isCursorResponse(value) {
  return isRecord(value) && value.version === 1 && typeof value.sessionId === "string" && typeof value.turnId === "string" && typeof value.text === "string" && typeof value.endedAt === "string";
}
function isPendingTurn(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && typeof value.projectId === "string" && typeof value.deliveryId === "string" && isCodingAgentTurn(value.turn) && value.turn.status === "completed";
}
function credentialsPath(dataDir) {
  return join(dataDir, "credentials.json");
}
function statePath(dataDir, directory, sessionId, turnId) {
  return join(dataDir, directory, `${safeId(`${sessionId}\0${turnId}`)}.json`);
}
function pendingPath(dataDir, traceId) {
  return join(dataDir, "pending", `${safeId(traceId)}.json`);
}
async function readCredentials(dataDir) {
  const value = await readJson(credentialsPath(dataDir));
  if (value === null) return null;
  if (!isCredentials(value)) throw new Error("Lemma Cursor credentials are invalid");
  return value;
}
async function readTurn(dataDir, sessionId, turnId) {
  const value = await readJson(statePath(dataDir, "turns", sessionId, turnId));
  if (value === null) return null;
  if (!isCodingAgentTurn(value)) throw new Error("Lemma Cursor turn state is invalid");
  return value;
}
async function writeTurn(dataDir, turn) {
  await writeSecureJson(
    statePath(dataDir, "turns", turn.sessionId, turn.turnId),
    turn
  );
}
async function readResponse(dataDir, sessionId, turnId) {
  const value = await readJson(
    statePath(dataDir, "responses", sessionId, turnId)
  );
  if (value === null) return null;
  if (!isCursorResponse(value)) {
    throw new Error("Lemma Cursor response state is invalid");
  }
  return value;
}
async function writeResponse(dataDir, response) {
  await writeSecureJson(
    statePath(dataDir, "responses", response.sessionId, response.turnId),
    response
  );
}
async function queueCompletedTurn(dataDir, turn, destination) {
  const path = pendingPath(dataDir, turn.traceId);
  const existing = await readJson(path);
  if (existing !== null) {
    if (!isPendingTurn(existing)) {
      throw new Error("Lemma Cursor pending turn is invalid");
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
        throw new Error("Timed out waiting for Lemma Cursor turn state lock");
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
var SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(input, name) {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function numberField(input, name) {
  const value = input[name];
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function eventName(input) {
  switch (input.hook_event_name) {
    case "beforeSubmitPrompt":
    case "UserPromptSubmit":
      return "beforeSubmitPrompt";
    case "preToolUse":
    case "PreToolUse":
      return "preToolUse";
    case "postToolUse":
    case "PostToolUse":
      return "postToolUse";
    case "postToolUseFailure":
    case "PostToolUseFailure":
      return "postToolUseFailure";
    case "afterAgentResponse":
    case "AgentResponse":
      return "afterAgentResponse";
    case "stop":
    case "Stop":
      return "stop";
    case "sessionEnd":
    case "SessionEnd":
      return "sessionEnd";
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
function sanitizeString(value) {
  return value.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]").replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]"
  );
}
function sanitizeCapturedValue(value) {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeCapturedValue);
  if (!isRecord2(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeCapturedValue(entry)
    ])
  );
}
function parsedToolOutput(value) {
  if (typeof value !== "string") return sanitizeCapturedValue(value);
  try {
    return sanitizeCapturedValue(JSON.parse(value));
  } catch {
    return sanitizeCapturedValue(value);
  }
}
function providerForModel(model) {
  if (!model) return void 0;
  const normalized = model.toLowerCase();
  if (normalized.includes("claude")) return "anthropic";
  if (/^(gpt|o[134]|codex)/.test(normalized)) return "openai";
  if (normalized.includes("gemini")) return "google";
  if (normalized.includes("grok")) return "xai";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("composer")) return "cursor";
  return void 0;
}
function modelName(input) {
  return stringField(input, "model_id") ?? stringField(input, "model");
}
function stringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const strings = value.filter((entry) => typeof entry === "string");
  return strings.length > 0 ? strings : void 0;
}
function turnMetadata(input) {
  const cwd = stringField(input, "cwd");
  const transcriptPath = stringField(input, "transcript_path");
  const cursorVersion = stringField(input, "cursor_version");
  const workspaceRoots = stringArray(input.workspace_roots);
  const modelParams = Array.isArray(input.model_params) ? sanitizeCapturedValue(input.model_params) : void 0;
  return {
    ...cwd ? { "lemma.harness.cwd": cwd } : {},
    ...transcriptPath ? { "lemma.harness.transcript_path": transcriptPath } : {},
    ...cursorVersion ? { "lemma.harness.cursor_version": cursorVersion } : {},
    ...workspaceRoots ? { "lemma.harness.workspace_roots": workspaceRoots } : {},
    ...modelParams ? { "lemma.harness.cursor_model_params": modelParams } : {}
  };
}
function transcriptTextParts(value) {
  if (!isRecord2(value) || !Array.isArray(value.content)) return [];
  return value.content.flatMap(
    (part) => isRecord2(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []
  );
}
function promptFromTranscriptText(text) {
  const matches = [...text.matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)];
  const prompt = matches.at(-1)?.[1]?.trim();
  return prompt ? sanitizeString(prompt) : null;
}
function stripCursorInternalFooter(text) {
  const footer = text.match(
    /\n\n\*\*[A-Z][A-Za-z-]+ing(?: [A-Za-z0-9`/-]+){2,7}\*\*\s*$/
  );
  return footer?.index === void 0 ? text : text.slice(0, footer.index).trimEnd();
}
async function readScriptedTranscript(transcriptPath) {
  let prompt = null;
  let response = null;
  for (const line of (await readFile2(transcriptPath, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord2(entry) || !isRecord2(entry.message)) continue;
    const text = transcriptTextParts(entry.message).join("\n").trim();
    if (!text) continue;
    if (entry.role === "user") {
      prompt = promptFromTranscriptText(text) ?? prompt;
    } else if (entry.role === "assistant") {
      response = sanitizeString(stripCursorInternalFooter(text));
    }
  }
  return prompt && response ? { prompt, response } : null;
}
async function handleCursorHook(input, dependencies = {}) {
  const event = eventName(input);
  const sessionId = stringField(input, "conversation_id");
  const turnId = stringField(input, "generation_id");
  if (!event || !sessionId || !turnId) return { status: "ignored" };
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  if (event === "beforeSubmitPrompt") {
    const prompt = stringField(input, "prompt");
    if (!prompt) return { status: "ignored" };
    const model = modelName(input);
    await withSessionLock(dataDir, sessionId, async () => {
      const existing = await readTurn(dataDir, sessionId, turnId);
      if (existing) return;
      await writeTurn(
        dataDir,
        startCodingAgentTurn({
          harness: "cursor",
          sessionId,
          turnId,
          generationId: turnId,
          prompt: sanitizeString(prompt),
          startedAt: eventTimestamp(input, now),
          model,
          provider: providerForModel(model),
          metadata: turnMetadata(input)
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "preToolUse") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      let turn = await readTurn(dataDir, sessionId, turnId);
      if (!turn && sessionId === turnId) {
        const model = modelName(input);
        turn = startCodingAgentTurn({
          harness: "cursor",
          sessionId,
          turnId,
          generationId: turnId,
          prompt: "",
          startedAt: eventTimestamp(input, now),
          model,
          provider: providerForModel(model),
          metadata: turnMetadata(input)
        });
      }
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolStart(turn, {
          toolUseId,
          toolName,
          input: sanitizeCapturedValue(input.tool_input),
          startedAt: eventTimestamp(input, now)
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "postToolUse" || event === "postToolUseFailure") {
    const toolUseId = stringField(input, "tool_use_id");
    const toolName = stringField(input, "tool_name");
    if (!toolUseId || !toolName) return { status: "ignored" };
    await withSessionLock(dataDir, sessionId, async () => {
      const turn = await readTurn(dataDir, sessionId, turnId);
      if (!turn || turn.status !== "open") return;
      const endedAt = eventTimestamp(input, now);
      const duration = numberField(input, "duration");
      let next = turn;
      if (!turn.tools.some((tool) => tool.toolUseId === toolUseId) && duration) {
        next = recordCodingAgentToolStart(next, {
          toolUseId,
          toolName,
          input: sanitizeCapturedValue(input.tool_input),
          startedAt: new Date(Date.parse(endedAt) - duration).toISOString()
        });
      }
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(next, {
          toolUseId,
          toolName,
          input: sanitizeCapturedValue(input.tool_input),
          output: event === "postToolUse" ? parsedToolOutput(input.tool_output) : void 0,
          error: event === "postToolUseFailure" ? sanitizeCapturedValue(
            stringField(input, "error_message") ?? input.failure_type
          ) : void 0,
          endedAt
        })
      );
    });
    return { status: "recorded", event };
  }
  if (event === "afterAgentResponse") {
    const text = stringField(input, "text") ?? "";
    await withSessionLock(dataDir, sessionId, async () => {
      if (!await readTurn(dataDir, sessionId, turnId)) return;
      await writeResponse(dataDir, {
        version: 1,
        sessionId,
        turnId,
        text: sanitizeString(text),
        endedAt: eventTimestamp(input, now)
      });
    });
    return { status: "recorded", event };
  }
  if (event === "sessionEnd") {
    if (sessionId !== turnId) return { status: "ignored" };
    const transcriptPath = stringField(input, "transcript_path");
    if (!transcriptPath) {
      dependencies.warn?.(
        "Lemma Cursor could not reconstruct the scripted prompt because sessionEnd omitted transcript_path"
      );
      return { status: "ignored" };
    }
    let transcript;
    try {
      transcript = await readScriptedTranscript(transcriptPath);
    } catch (error) {
      dependencies.warn?.(
        `Lemma Cursor could not read the scripted prompt transcript: ${error instanceof Error ? error.message : String(error)}`
      );
      return { status: "ignored" };
    }
    if (!transcript) {
      dependencies.warn?.(
        "Lemma Cursor could not reconstruct a complete scripted prompt from the transcript"
      );
      return { status: "ignored" };
    }
    const credentials2 = await readCredentials(dataDir);
    if (!credentials2) {
      dependencies.warn?.(
        "Lemma Cursor did not queue the completed prompt because setup is incomplete"
      );
      return { status: "ignored" };
    }
    const traceId2 = await withSessionLock(dataDir, sessionId, async () => {
      const existing = await readTurn(dataDir, sessionId, turnId);
      const model = modelName(input) ?? existing?.model;
      const open = existing?.status === "open" ? {
        ...existing,
        prompt: transcript.prompt,
        model,
        provider: providerForModel(model) ?? existing.provider,
        metadata: {
          ...existing.metadata ?? {},
          ...turnMetadata(input)
        }
      } : existing?.status === "completed" ? existing : startCodingAgentTurn({
        harness: "cursor",
        sessionId,
        turnId,
        generationId: turnId,
        prompt: transcript.prompt,
        startedAt: eventTimestamp(input, now),
        model,
        provider: providerForModel(model),
        metadata: turnMetadata(input)
      });
      const completed = open.status === "completed" ? open : completeCodingAgentTurn(open, {
        response: transcript.response,
        endedAt: eventTimestamp(input, now),
        model,
        provider: providerForModel(model) ?? open.provider
      });
      if (open.status === "open") await writeTurn(dataDir, completed);
      await queueCompletedTurn(dataDir, completed, credentials2);
      return completed.traceId;
    });
    return { status: "queued", traceId: traceId2 };
  }
  const credentials = await readCredentials(dataDir);
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Cursor did not queue the completed prompt because setup is incomplete"
    );
    return { status: "ignored" };
  }
  const traceId = await withSessionLock(dataDir, sessionId, async () => {
    const turn = await readTurn(dataDir, sessionId, turnId);
    if (!turn) return null;
    const response = await readResponse(dataDir, sessionId, turnId);
    const model = modelName(input) ?? turn.model;
    const completed = turn.status === "completed" ? turn : completeCodingAgentTurn(turn, {
      response: response?.text ?? "",
      endedAt: eventTimestamp(input, now),
      model,
      provider: providerForModel(model) ?? turn.provider
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
  const flushEntry = resolve(dirname2(fileURLToPath(import.meta.url)), "flush.mjs");
  const child = spawn(process.execPath, [flushEntry], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
}
function hookOutput(input) {
  switch (input.hook_event_name) {
    case "beforeSubmitPrompt":
    case "UserPromptSubmit":
      return { continue: true };
    case "preToolUse":
    case "PreToolUse":
      return { permission: "allow" };
    default:
      return {};
  }
}
async function main() {
  let input = {};
  try {
    delete process.env.LEMMA_DEBUG;
    delete process.env.LEMMA_DEBUG_VERIFY;
    input = JSON.parse(await readStdin());
    const result = await handleCursorHook(input, {
      warn: (message) => stderr.write(`${message}
`)
    });
    if (result.status === "queued" || result.status === "recorded" && result.event === "beforeSubmitPrompt") {
      scheduleTraceDelivery();
    }
  } catch (error) {
    stderr.write(
      `Lemma Cursor hook failed open: ${error instanceof Error ? error.message : String(error)}
`
    );
  }
  stdout.write(`${JSON.stringify(hookOutput(input))}
`);
}
await main();
