import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { CompletedCodingAgentTurn } from "@uselemma/tracing";
import type { LemmaPiCredentials } from "./credentials.js";
import { createLemmaPiExtension } from "./extension.js";

type Handler = (event: never, context: ExtensionContext) => unknown;

function extensionFixture() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  const warnings: string[] = [];
  const context = {
    model: { id: "claude-sonnet-4", provider: "anthropic" },
    sessionManager: { getSessionId: () => "session-1" },
    ui: { notify: (message: string) => warnings.push(message) },
  } as unknown as ExtensionContext;
  return { handlers, pi, context, warnings };
}

describe("Pi extension compatibility adapter", () => {
  it("maps native Pi lifecycle events with sensitive tool data redacted", async () => {
    const fixture = extensionFixture();
    const sendTrace = vi.fn(
      async (
        _turn: CompletedCodingAgentTurn,
        _credentials: LemmaPiCredentials,
      ) => undefined,
    );
    let counter = 0;
    createLemmaPiExtension({
      now: () => new Date(Date.UTC(2026, 7, 21, 1, 0, counter++)),
      createId: () => "turn-1",
      readCredentials: () => ({
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "10000000-0000-0000-0000-000000000001",
        credentialId: "credential-1",
        accessToken: "lemma_ci_scoped-secret",
      }),
      sendTrace,
    })(fixture.pi);

    await fixture.handlers.get("before_agent_start")?.(
      { type: "before_agent_start", prompt: "Inspect the repo" } as never,
      fixture.context,
    );
    await fixture.handlers.get("tool_execution_start")?.(
      {
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "README.md", apiKey: "must-not-leak" },
      } as never,
      fixture.context,
    );
    await fixture.handlers.get("tool_execution_end")?.(
      {
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: { text: "contents", access_token: "must-not-leak" },
        isError: false,
      } as never,
      fixture.context,
    );
    await fixture.handlers.get("agent_end")?.(
      {
        type: "agent_end",
        messages: [
          { role: "user", content: "Inspect the repo" },
          { role: "assistant", content: [{ type: "text", text: "Done" }] },
        ],
      } as never,
      fixture.context,
    );

    expect(sendTrace).toHaveBeenCalledOnce();
    expect(sendTrace.mock.calls[0][0]).toMatchObject({
      harness: "pi",
      sessionId: "session-1",
      turnId: "turn-1",
      prompt: "Inspect the repo",
      response: "Done",
      metadata: {
        "lemma.harness.session_event_source": "native-lifecycle",
        "pi.compatibility_source": "extension-events",
      },
    });
    expect(JSON.stringify(sendTrace.mock.calls[0][0])).not.toContain(
      "must-not-leak",
    );
  });

  it("fails closed when setup has not stored credentials", async () => {
    const fixture = extensionFixture();
    const sendTrace = vi.fn(
      async (
        _turn: CompletedCodingAgentTurn,
        _credentials: LemmaPiCredentials,
      ) => undefined,
    );
    createLemmaPiExtension({
      readCredentials: () => null,
      sendTrace,
    })(fixture.pi);
    await fixture.handlers.get("before_agent_start")?.(
      { type: "before_agent_start", prompt: "hello" } as never,
      fixture.context,
    );
    await fixture.handlers.get("agent_end")?.(
      { type: "agent_end", messages: [] } as never,
      fixture.context,
    );
    expect(sendTrace).not.toHaveBeenCalled();
    expect(fixture.warnings.join("\n")).toContain(
      "rotate the scoped credential",
    );
  });
});
