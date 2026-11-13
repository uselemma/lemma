/**
 * Display text from chat and Responses content blocks.
 * Reasoning and encrypted reasoning are not part of the reply.
 */

export function isReplyReasoning(record: Record<string, unknown>): boolean {
  return (
    record.type === "reasoning" || typeof record.encrypted_content === "string"
  );
}

export type ContentReply = {
  parts: string[];
  /** A text, output_text, reasoning, or encrypted block was present. */
  recognized: boolean;
};

export function readContentReply(content: unknown): ContentReply | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  let recognized = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (isReplyReasoning(record)) {
      recognized = true;
      continue;
    }
    if (
      (record.type === "text" || record.type === "output_text") &&
      typeof record.text === "string"
    ) {
      parts.push(record.text);
      recognized = true;
    }
  }
  return { parts, recognized };
}

function textFromContentParts(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  const reply = readContentReply(content);
  if (!reply || !reply.recognized) return undefined;
  return reply.parts.join("");
}

/** Reply text for a generation or Responses output list. */
export function textFromGenerationOutput(output: unknown): unknown {
  if (!Array.isArray(output)) return output;
  let text = "";
  let sawUnhandled = false;
  for (const item of output) {
    if (!item || typeof item !== "object") {
      sawUnhandled = true;
      continue;
    }
    const record = item as Record<string, unknown>;
    if (isReplyReasoning(record)) continue;
    if (typeof record.text === "string") {
      text += record.text;
      continue;
    }
    if (typeof record.content === "string") {
      text += record.content;
      continue;
    }
    if (Array.isArray(record.content)) {
      const fromParts = textFromContentParts(record.content);
      if (fromParts !== undefined) {
        text += fromParts;
        continue;
      }
    }
    sawUnhandled = true;
  }
  if (text) return text;
  // Reasoning-only output must not fall back to the raw item array.
  if (!sawUnhandled && output.length > 0) return "";
  return output;
}
