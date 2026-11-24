import type { HarnessId } from "./harness.js";
import {
  codexToml,
  hermesYaml,
  MCP_SERVER_NAME,
  mcpServersJson,
  opencodeJson,
  openclawJson,
  type McpConfigFormat,
} from "./mcp/formats.js";
import {
  codexConfigPath,
  cursorConfigPath,
  hermesConfigPath,
  opencodeConfigPath,
  openclawConfigPath,
  piConfigPath,
  type ConfigLocationInput,
} from "./mcp/paths.js";

/**
 * How one coding agent configures MCP servers, and so how setup adds Lemma.
 * `reload` is the clause telling the user how to load the new server.
 */
type McpConfigMethod =
  | { kind: "claude-cli"; reload: string }
  | {
      kind: "file";
      path: (input: ConfigLocationInput) => string;
      /** The shape the config file has; a printed entry uses it too. */
      format: McpConfigFormat;
      reload: string;
    }
  /**
   * No documented config format: setup prints the entry, in the generic
   * `format`, for the person to add.
   */
  | { kind: "manual"; format: McpConfigFormat };

/** A coding agent's own sign-in command, which runs the OAuth flow in the browser. */
export type SignInCommand = { command: string; args: readonly string[] };

/**
 * How a person signs one coding agent in to Lemma's MCP server once its
 * `lemma` server is in place: the agent's command, which setup runs at a
 * terminal and prints otherwise, and the same sign-in from inside the agent,
 * a clause after "to sign in to Lemma as yourself,". Every agent has at
 * least one.
 */
export type McpSignIn =
  | { command: SignInCommand; inAgent: string | null }
  | { command: null; inAgent: string };

type CodingAgent = {
  codingAgentName: string;
  mcp: McpConfigMethod;
  signIn: McpSignIn;
};

/** The agent's sign-in command for the `lemma` server: `<command> <args…> lemma`. */
function signInCommand(command: string, ...args: string[]): SignInCommand {
  return { command, args: [...args, MCP_SERVER_NAME] };
}

/**
 * Everything setup knows about each coding agent, in one place. Each
 * sign-in command is the agent's documented MCP OAuth login; Cursor's runs
 * through its CLI, `agent`.
 */
export const CODING_AGENTS: Readonly<Record<HarnessId, CodingAgent>> = {
  "claude-code": {
    codingAgentName: "Claude Code",
    mcp: {
      kind: "claude-cli",
      reload:
        "restart Claude Code, or reconnect it with /mcp, to load the Lemma tools",
    },
    signIn: {
      command: signInCommand("claude", "mcp", "login"),
      inAgent: "run /mcp in Claude Code, select `lemma`, and authenticate",
    },
  },
  cursor: {
    codingAgentName: "Cursor",
    mcp: {
      kind: "file",
      path: cursorConfigPath,
      format: mcpServersJson,
      reload: "reload MCP servers in Cursor Settings to load the Lemma tools",
    },
    signIn: {
      command: signInCommand("agent", "mcp", "login"),
      inAgent: "sign in to `lemma` from Cursor's MCP settings",
    },
  },
  pi: {
    codingAgentName: "Pi",
    mcp: {
      kind: "file",
      path: piConfigPath,
      format: mcpServersJson,
      reload: "run /reload in Pi to load the Lemma tools",
    },
    signIn: {
      command: signInCommand("pi", "mcp", "login"),
      inAgent: "run /mcp in Pi, select `lemma`, and choose Sign in",
    },
  },
  codex: {
    codingAgentName: "Codex",
    mcp: {
      kind: "file",
      path: codexConfigPath,
      format: codexToml,
      reload: "start a new Codex session to load the Lemma tools",
    },
    signIn: { command: signInCommand("codex", "mcp", "login"), inAgent: null },
  },
  opencode: {
    codingAgentName: "OpenCode",
    mcp: {
      kind: "file",
      path: opencodeConfigPath,
      format: opencodeJson,
      reload: "restart OpenCode to load the Lemma tools",
    },
    signIn: {
      command: signInCommand("opencode", "mcp", "auth"),
      inAgent: "run /mcps in OpenCode, select `lemma`, and sign in",
    },
  },
  hermes: {
    codingAgentName: "Hermes",
    mcp: {
      kind: "file",
      path: hermesConfigPath,
      format: hermesYaml,
      reload: "run /reload-mcp in Hermes to load the Lemma tools",
    },
    // Hermes' in-session reload waits too briefly for a browser sign-in.
    signIn: { command: signInCommand("hermes", "mcp", "login"), inAgent: null },
  },
  openclaw: {
    codingAgentName: "OpenClaw",
    mcp: {
      kind: "file",
      path: openclawConfigPath,
      format: openclawJson,
      reload:
        "OpenClaw's gateway applies config changes on its own; restart it if the Lemma tools do not appear",
    },
    signIn: {
      command: signInCommand("openclaw", "mcp", "login"),
      inAgent: null,
    },
  },
  other: {
    codingAgentName: "your coding agent",
    mcp: { kind: "manual", format: mcpServersJson },
    signIn: {
      command: null,
      inAgent:
        "follow your coding agent's steps for an MCP server that asks you to sign in",
    },
  },
};
