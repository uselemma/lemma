import type { SpanHandle } from "./client";

/**
 * Agent, task, and turn spans carry no model payload of their own. They take
 * the first input and the latest output of the model calls beneath them.
 */
export function isContainerType(type: string) {
  return type === "agent" || type === "task" || type === "turn";
}

export type SpanRecord = {
  handle: SpanHandle;
  traceId: string;
  type: string;
  parentId?: string | null;
  /** True once the span ended carrying its own output. */
  ownOutput: boolean;
  /** First input of a model call under this container, while it is open. */
  childInput?: unknown;
  /** Latest output of a model call under this container, while it is open. */
  childOutput?: unknown;
};

export type GenerationIo = { input?: unknown; output?: unknown };

/**
 * Hand a finished model call's input and output to every container above it.
 * An open container accumulates them for its own end; one that already ended
 * is filled in place.
 */
export function propagateGenerationIo(
  parentId: string | null | undefined,
  io: GenerationIo,
  open: ReadonlyMap<string, SpanRecord>,
  ended: ReadonlyMap<string, SpanRecord>,
) {
  if (io.input === undefined && io.output === undefined) return;
  const seen = new Set<string>();
  let id = parentId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const endedRecord = ended.get(id);
    const record = endedRecord ?? open.get(id);
    if (!record) return;
    if (isContainerType(record.type)) {
      if (endedRecord) {
        endedRecord.handle.fillContainerIo(
          io.input,
          io.output,
          endedRecord.ownOutput,
        );
      } else {
        if (record.childInput === undefined) record.childInput = io.input;
        if (io.output !== undefined) record.childOutput = io.output;
      }
    }
    id = record.parentId ?? null;
  }
}
