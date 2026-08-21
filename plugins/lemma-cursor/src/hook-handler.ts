import { readFile } from "node:fs/promises";

import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn,
} from "../../../packages/ts/tracing/src/index.js";

import {
  listPendingTurns,
  queueCompletedTurn,
  readCredentials,
  readPendingTurn,
  readResponse,
  readTurn,
  removePending,
  removeResponse,
  removeTurn,
  resolveDataDir,
  withSessionLock,
  writeResponse,
  writeTurn,
} from "./storage.js";

type CursorEventName =
  | "beforeSubmitPrompt"
  | "preToolUse"
  | "postToolUse"
  | "postToolUseFailure"
  | "afterAgentResponse"
  | "stop"
  | "sessionEnd";

export type CursorHookInput = Record<string, unknown> & {
  hook_event_name?: unknown;
  conversation_id?: unknown;
  generation_id?: unknown;
};

export type HookHandlerDependencies = {
  dataDir?: string;
  now?: () => Date;
  sendTrace?: (input: {
    apiUrl: string;
    projectId: string;
    accessToken: string;
    turn: Parameters<typeof codingAgentTurnTrace>[0];
  }) => Promise<void>;
  warn?: (message: string) => void;
};

export type HookHandlerResult =
  | { status: "ignored" }
  | { status: "recorded"; event: CursorEventName }
  | { status: "queued"; traceId: string };

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(input: CursorHookInput, name: string): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(input: CursorHookInput, name: string): number | undefined {
  const value = input[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function eventName(input: CursorHookInput): CursorEventName | null {
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

function eventTimestamp(input: CursorHookInput, now: () => Date): string {
  const supplied = stringField(input, "timestamp");
  if (supplied && !Number.isNaN(Date.parse(supplied))) {
    return new Date(supplied).toISOString();
  }
  return now().toISOString();
}

function sanitizeString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}

export function sanitizeCapturedValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeCapturedValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeCapturedValue(entry),
    ]),
  );
}

function parsedToolOutput(value: unknown): unknown {
  if (typeof value !== "string") return sanitizeCapturedValue(value);
  try {
    return sanitizeCapturedValue(JSON.parse(value) as unknown);
  } catch {
    return sanitizeCapturedValue(value);
  }
}

function providerForModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const normalized = model.toLowerCase();
  if (normalized.includes("claude")) return "anthropic";
  if (/^(gpt|o[134]|codex)/.test(normalized)) return "openai";
  if (normalized.includes("gemini")) return "google";
  if (normalized.includes("grok")) return "xai";
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("composer")) return "cursor";
  return undefined;
}

function modelName(input: CursorHookInput): string | undefined {
  return stringField(input, "model_id") ?? stringField(input, "model");
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}

function turnMetadata(input: CursorHookInput): Record<string, unknown> {
  const cwd = stringField(input, "cwd");
  const transcriptPath = stringField(input, "transcript_path");
  const cursorVersion = stringField(input, "cursor_version");
  const workspaceRoots = stringArray(input.workspace_roots);
  const modelParams = Array.isArray(input.model_params)
    ? sanitizeCapturedValue(input.model_params)
    : undefined;
  return {
    ...(cwd ? { "lemma.harness.cwd": cwd } : {}),
    ...(transcriptPath
      ? { "lemma.harness.transcript_path": transcriptPath }
      : {}),
    ...(cursorVersion
      ? { "lemma.harness.cursor_version": cursorVersion }
      : {}),
    ...(workspaceRoots
      ? { "lemma.harness.workspace_roots": workspaceRoots }
      : {}),
    ...(modelParams
      ? { "lemma.harness.cursor_model_params": modelParams }
      : {}),
  };
}

type ScriptedTranscriptTurn = {
  prompt: string;
  response: string;
};

function transcriptTextParts(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.content)) return [];
  return value.content.flatMap((part) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string"
      ? [part.text]
      : [],
  );
}

function promptFromTranscriptText(text: string): string | null {
  const matches = [...text.matchAll(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/g)];
  const prompt = matches.at(-1)?.[1]?.trim();
  return prompt ? sanitizeString(prompt) : null;
}

function stripCursorInternalFooter(text: string): string {
  const footer = text.match(
    /\n\n\*\*[A-Z][A-Za-z-]+ing(?: [A-Za-z0-9`/-]+){2,7}\*\*\s*$/,
  );
  return footer?.index === undefined ? text : text.slice(0, footer.index).trimEnd();
}

async function readScriptedTranscript(
  transcriptPath: string,
): Promise<ScriptedTranscriptTurn | null> {
  let prompt: string | null = null;
  let response: string | null = null;
  for (const line of (await readFile(transcriptPath, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(entry) || !isRecord(entry.message)) continue;
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

async function defaultSendTrace(input: {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  turn: Parameters<typeof codingAgentTurnTrace>[0];
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const fetchWithTimeout: typeof fetch = async (request, init) =>
    fetch(request, { ...init, signal: controller.signal });
  const lemma = new Lemma({
    apiKey: input.accessToken,
    projectId: input.projectId,
    baseUrl: input.apiUrl,
    fetch: fetchWithTimeout,
  });
  const trace = codingAgentTurnTrace(input.turn);
  try {
    await lemma.ingest(trace.context, {
      startedAt: new Date(trace.startedAt),
      endedAt: new Date(trace.endedAt),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushPendingTurns(
  dependencies: HookHandlerDependencies = {},
): Promise<number> {
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  return withSessionLock(dataDir, "lemma-cursor-delivery", async () => {
    const credentials = await readCredentials(dataDir);
    if (!credentials) return 0;
    const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
    let sent = 0;
    for (const listed of await listPendingTurns(dataDir)) {
      const pending = await readPendingTurn(listed.path);
      if (!pending) continue;
      if (
        pending.apiUrl !== credentials.apiUrl ||
        pending.projectId !== credentials.projectId
      ) {
        dependencies.warn?.(
          `Lemma Cursor retained trace ${pending.turn.traceId}: it belongs to another configured project`,
        );
        continue;
      }
      try {
        await sendTrace({
          apiUrl: credentials.apiUrl,
          projectId: credentials.projectId,
          accessToken: credentials.accessToken,
          turn: pending.turn,
        });
        await withSessionLock(dataDir, pending.turn.sessionId, async () => {
          const latest = await readPendingTurn(pending.path);
          if (latest?.deliveryId !== pending.deliveryId) return;
          await removePending(pending.path);
          await removeTurn(
            dataDir,
            pending.turn.sessionId,
            pending.turn.turnId,
          );
          await removeResponse(
            dataDir,
            pending.turn.sessionId,
            pending.turn.turnId,
          );
        });
        sent += 1;
      } catch (error) {
        dependencies.warn?.(
          `Lemma Cursor retained a trace for retry (${pending.turn.traceId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return sent;
  });
}

export async function handleCursorHook(
  input: CursorHookInput,
  dependencies: HookHandlerDependencies = {},
): Promise<HookHandlerResult> {
  const event = eventName(input);
  const sessionId = stringField(input, "conversation_id");
  const turnId = stringField(input, "generation_id");
  if (!event || !sessionId || !turnId) return { status: "ignored" };
  const dataDir = resolveDataDir({ dataDir: dependencies.dataDir });
  const now = dependencies.now ?? (() => new Date());

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
          metadata: turnMetadata(input),
        }),
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
          metadata: turnMetadata(input),
        });
      }
      if (!turn || turn.status !== "open") return;
      await writeTurn(
        dataDir,
        recordCodingAgentToolStart(turn, {
          toolUseId,
          toolName,
          input: sanitizeCapturedValue(input.tool_input),
          startedAt: eventTimestamp(input, now),
        }),
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
          startedAt: new Date(Date.parse(endedAt) - duration).toISOString(),
        });
      }
      await writeTurn(
        dataDir,
        recordCodingAgentToolResult(next, {
          toolUseId,
          toolName,
          input: sanitizeCapturedValue(input.tool_input),
          output:
            event === "postToolUse"
              ? parsedToolOutput(input.tool_output)
              : undefined,
          error:
            event === "postToolUseFailure"
              ? sanitizeCapturedValue(
                  stringField(input, "error_message") ?? input.failure_type,
                )
              : undefined,
          endedAt,
        }),
      );
    });
    return { status: "recorded", event };
  }

  if (event === "afterAgentResponse") {
    const text = stringField(input, "text") ?? "";
    await withSessionLock(dataDir, sessionId, async () => {
      if (!(await readTurn(dataDir, sessionId, turnId))) return;
      await writeResponse(dataDir, {
        version: 1,
        sessionId,
        turnId,
        text: sanitizeString(text),
        endedAt: eventTimestamp(input, now),
      });
    });
    return { status: "recorded", event };
  }

  if (event === "sessionEnd") {
    if (sessionId !== turnId) return { status: "ignored" };
    const transcriptPath = stringField(input, "transcript_path");
    if (!transcriptPath) {
      dependencies.warn?.(
        "Lemma Cursor could not reconstruct the scripted prompt because sessionEnd omitted transcript_path",
      );
      return { status: "ignored" };
    }
    let transcript: ScriptedTranscriptTurn | null;
    try {
      transcript = await readScriptedTranscript(transcriptPath);
    } catch (error) {
      dependencies.warn?.(
        `Lemma Cursor could not read the scripted prompt transcript: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: "ignored" };
    }
    if (!transcript) {
      dependencies.warn?.(
        "Lemma Cursor could not reconstruct a complete scripted prompt from the transcript",
      );
      return { status: "ignored" };
    }
    const credentials = await readCredentials(dataDir);
    if (!credentials) {
      dependencies.warn?.(
        "Lemma Cursor did not queue the completed prompt because setup is incomplete",
      );
      return { status: "ignored" };
    }
    const traceId = await withSessionLock(dataDir, sessionId, async () => {
      const existing = await readTurn(dataDir, sessionId, turnId);
      const model = modelName(input) ?? existing?.model;
      const open =
        existing?.status === "open"
          ? {
              ...existing,
              prompt: transcript.prompt,
              model,
              provider: providerForModel(model) ?? existing.provider,
              metadata: {
                ...(existing.metadata ?? {}),
                ...turnMetadata(input),
              },
            }
          : existing?.status === "completed"
            ? existing
            : startCodingAgentTurn({
                harness: "cursor",
                sessionId,
                turnId,
                generationId: turnId,
                prompt: transcript.prompt,
                startedAt: eventTimestamp(input, now),
                model,
                provider: providerForModel(model),
                metadata: turnMetadata(input),
              });
      const completed =
        open.status === "completed"
          ? open
          : completeCodingAgentTurn(open, {
              response: transcript.response,
              endedAt: eventTimestamp(input, now),
              model,
              provider: providerForModel(model) ?? open.provider,
            });
      if (open.status === "open") await writeTurn(dataDir, completed);
      await queueCompletedTurn(dataDir, completed, credentials);
      return completed.traceId;
    });
    return { status: "queued", traceId };
  }

  const credentials = await readCredentials(dataDir);
  if (!credentials) {
    dependencies.warn?.(
      "Lemma Cursor did not queue the completed prompt because setup is incomplete",
    );
    return { status: "ignored" };
  }
  const traceId = await withSessionLock(dataDir, sessionId, async () => {
    const turn = await readTurn(dataDir, sessionId, turnId);
    if (!turn) return null;
    const response = await readResponse(dataDir, sessionId, turnId);
    const model = modelName(input) ?? turn.model;
    const completed =
      turn.status === "completed"
        ? turn
        : completeCodingAgentTurn(turn, {
            response: response?.text ?? "",
            endedAt: eventTimestamp(input, now),
            model,
            provider: providerForModel(model) ?? turn.provider,
          });
    if (turn.status === "open") await writeTurn(dataDir, completed);
    await queueCompletedTurn(dataDir, completed, credentials);
    return completed.traceId;
  });
  return traceId ? { status: "queued", traceId } : { status: "ignored" };
}
