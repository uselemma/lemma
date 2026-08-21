// src/extension.ts
import { randomUUID } from "node:crypto";
import {
  Lemma,
  codingAgentTurnTrace,
  completeCodingAgentTurn,
  recordCodingAgentToolResult,
  recordCodingAgentToolStart,
  startCodingAgentTurn
} from "@uselemma/tracing";

// src/credentials.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
var LEMMA_PI_CREDENTIALS_HELP = "Lemma Pi credentials are missing or invalid. Run `pnpm dlx @uselemma/pi setup` to connect or rotate the scoped credential.";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCredentials(value) {
  return isRecord(value) && value.version === 1 && typeof value.apiUrl === "string" && value.apiUrl.length > 0 && typeof value.projectId === "string" && value.projectId.length > 0 && typeof value.credentialId === "string" && value.credentialId.length > 0 && typeof value.accessToken === "string" && value.accessToken.length > 0;
}
function resolveDataDir(options = {}) {
  const env = options.env ?? process.env;
  const configured = options.dataDir ?? env.LEMMA_PI_DATA_DIR;
  return configured ? resolve(configured) : join(options.homeDir ?? homedir(), ".pi", "agent", "lemma");
}
function credentialsPath(options = {}) {
  return join(resolveDataDir(options), "credentials.json");
}
function readCredentialsSync(options = {}) {
  try {
    const value = JSON.parse(
      readFileSync(credentialsPath(options), "utf8")
    );
    if (!isCredentials(value)) throw new Error(LEMMA_PI_CREDENTIALS_HELP);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError)
      throw new Error(LEMMA_PI_CREDENTIALS_HELP);
    throw error;
  }
}

// src/sanitize.ts
var SENSITIVE_KEY = /(^|[-_.])(authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)($|[-_.])/i;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord2(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(
      ([key, entry]) => SENSITIVE_KEY.test(key) ? [] : [[key, sanitizeValue(entry)]]
    )
  );
}

// src/extension.ts
function messageText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(
    (part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []
  ).join("");
}
function assistantResponse(event) {
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message.role === "assistant") return messageText(message);
  }
  return "";
}
async function defaultSendTrace(turn, credentials) {
  const trace = codingAgentTurnTrace(turn);
  await new Lemma({
    apiKey: credentials.accessToken,
    projectId: credentials.projectId,
    baseUrl: credentials.apiUrl
  }).ingest(trace.context, {
    startedAt: new Date(trace.startedAt),
    endedAt: new Date(trace.endedAt)
  });
}
function warn(ctx, message) {
  ctx.ui.notify(message, "warning");
}
function createLemmaPiExtension(dependencies = {}) {
  const now = dependencies.now ?? (() => /* @__PURE__ */ new Date());
  const createId = dependencies.createId ?? randomUUID;
  const readCredentials = dependencies.readCredentials ?? (() => readCredentialsSync());
  const sendTrace = dependencies.sendTrace ?? defaultSendTrace;
  let activeTurn;
  return (pi) => {
    pi.on(
      "before_agent_start",
      (event, ctx) => {
        activeTurn = startCodingAgentTurn({
          harness: "pi",
          sessionId: ctx.sessionManager.getSessionId(),
          turnId: createId(),
          prompt: event.prompt,
          startedAt: now().toISOString(),
          model: ctx.model?.id,
          provider: ctx.model?.provider,
          metadata: {
            "lemma.harness.session_event_source": "native-lifecycle",
            "pi.compatibility_source": "extension-events"
          }
        });
      }
    );
    pi.on("tool_execution_start", (event) => {
      if (!activeTurn) return;
      activeTurn = recordCodingAgentToolStart(activeTurn, {
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        input: sanitizeValue(event.args),
        startedAt: now().toISOString()
      });
    });
    pi.on("tool_execution_end", (event) => {
      if (!activeTurn) return;
      activeTurn = recordCodingAgentToolResult(activeTurn, {
        toolUseId: event.toolCallId,
        toolName: event.toolName,
        output: event.isError ? void 0 : sanitizeValue(event.result),
        error: event.isError ? "Pi tool execution failed" : void 0,
        endedAt: now().toISOString()
      });
    });
    pi.on("agent_end", async (event, ctx) => {
      const open = activeTurn;
      activeTurn = void 0;
      if (!open) return;
      let credentials;
      try {
        credentials = readCredentials();
      } catch {
        warn(ctx, LEMMA_PI_CREDENTIALS_HELP);
        return;
      }
      if (!credentials) {
        warn(ctx, LEMMA_PI_CREDENTIALS_HELP);
        return;
      }
      const completed = completeCodingAgentTurn(open, {
        response: assistantResponse(event),
        endedAt: now().toISOString(),
        model: ctx.model?.id,
        provider: ctx.model?.provider
      });
      try {
        await sendTrace(completed, credentials);
      } catch {
        warn(
          ctx,
          "Lemma Pi trace delivery failed. Run `pnpm dlx @uselemma/pi setup` to reconnect or rotate the scoped credential."
        );
      }
    });
  };
}

// src/extension-entry.ts
var extension_entry_default = createLemmaPiExtension();
export {
  extension_entry_default as default
};
