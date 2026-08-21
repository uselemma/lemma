import type { Plugin } from "@opencode-ai/plugin";

import { createOpenCodeAdapter } from "./adapter.js";
import { DEFAULT_FLUSH_TIMEOUT_MS, flushPendingTurns } from "./flush.js";

export const LemmaPlugin: Plugin = async ({ client, directory }) => {
  const warn = (message: string) => console.warn(message);
  let disposing = false;
  let flushRequested = false;
  let flushPromise: Promise<void> | undefined;
  const runFlush = (deadline?: number): Promise<void> => {
    flushRequested = true;
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      do {
        flushRequested = false;
        await flushPendingTurns({ warn, deadline });
      } while (flushRequested && !disposing);
    })()
      .catch((error: unknown) => {
        console.warn(
          `Lemma OpenCode flush failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        flushPromise = undefined;
        if (flushRequested && !disposing) void runFlush();
      });
    return flushPromise;
  };
  const scheduleFlush = () => {
    void runFlush();
  };
  const adapter = createOpenCodeAdapter({
    client,
    directory,
    scheduleFlush,
  });
  scheduleFlush();
  return {
    "chat.message": async (_input, output) => {
      await adapter.chatMessage(output.message, output.parts);
    },
    "tool.execute.before": async (input, output) => {
      adapter.beforeTool(input, output.args);
    },
    "tool.execute.after": async (input, output) => {
      adapter.afterTool(input, output);
    },
    event: async ({ event }) => {
      await adapter.event(event);
    },
    dispose: async () => {
      disposing = true;
      const deadline = Date.now() + DEFAULT_FLUSH_TIMEOUT_MS;
      let disposalError: unknown;
      try {
        await adapter.dispose();
      } catch (error) {
        disposalError = error;
      }
      await flushPromise;
      if (Date.now() < deadline) await runFlush(deadline);
      if (disposalError) throw disposalError;
    },
  };
};
