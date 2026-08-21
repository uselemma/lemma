declare module "openclaw/plugin-sdk/plugin-entry" {
  export type PluginHookAgentContext = {
    runId?: string;
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    modelProviderId?: string;
    modelId?: string;
    channel?: string;
    trigger?: string;
  };

  export type PluginHookBeforeAgentRunEvent = {
    prompt: string;
    messages: unknown[];
    systemPrompt?: string;
    accountId?: string;
    channelId?: string;
    senderId?: string;
    senderIsOwner?: boolean;
  };

  export type PluginHookAgentEndEvent = {
    runId?: string;
    messages: unknown[];
    success: boolean;
    error?: string;
    durationMs?: number;
  };

  export type PluginHookToolContext = {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
    toolName: string;
    toolCallId?: string;
    channelId?: string;
  };

  export type PluginHookBeforeToolCallEvent = {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
    derivedPaths?: readonly string[];
  };

  export type PluginHookAfterToolCallEvent = {
    toolName: string;
    params: Record<string, unknown>;
    runId?: string;
    toolCallId?: string;
    result?: unknown;
    error?: string;
    durationMs?: number;
  };

  type HookMap = {
    before_agent_run: (
      event: PluginHookBeforeAgentRunEvent,
      context: PluginHookAgentContext,
    ) => Promise<void> | void;
    agent_end: (
      event: PluginHookAgentEndEvent,
      context: PluginHookAgentContext,
    ) => Promise<void> | void;
    before_tool_call: (
      event: PluginHookBeforeToolCallEvent,
      context: PluginHookToolContext,
    ) => Promise<void> | void;
    after_tool_call: (
      event: PluginHookAfterToolCallEvent,
      context: PluginHookToolContext,
    ) => Promise<void> | void;
  };

  export type OpenClawPluginApi = {
    logger: {
      info(message: string): void;
      warn(message: string): void;
      error(message: string): void;
      debug?(message: string): void;
    };
    on<K extends keyof HookMap>(
      hookName: K,
      handler: HookMap[K],
      options?: { priority?: number; timeoutMs?: number },
    ): void;
  };

  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    register(api: OpenClawPluginApi): void;
  }): {
    id: string;
    name: string;
    description: string;
    register(api: OpenClawPluginApi): void;
  };
}
