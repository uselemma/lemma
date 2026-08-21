import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createOpenClawAdapter } from "./adapter.js";

export default definePluginEntry({
  id: "lemma",
  name: "Lemma",
  description: "Project-scoped Lemma SDK tracing for OpenClaw agent sessions.",
  register(api) {
    const adapter = createOpenClawAdapter();
    api.on("before_agent_run", adapter.beforeAgentRun);
    api.on("before_tool_call", adapter.beforeToolCall);
    api.on("after_tool_call", adapter.afterToolCall);
    api.on(
      "agent_end",
      async (event, context) => {
        try {
          await adapter.agentEnd(event, context);
        } catch {
          api.logger.warn(
            "Lemma OpenClaw could not queue this trace. The agent run was not interrupted.",
          );
        }
      },
      { timeoutMs: 5_000 },
    );
  },
});
