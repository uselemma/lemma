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
