import type { HarnessId } from "./harness.js";
import {
  codexToml,
  hermesYaml,
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
      /** The shape the config file has; the private file uses it too. */
      format: McpConfigFormat;
      reload: string;
    }
  /**
   * No documented config format: a private file the user copies from, in
   * the generic `format`.
   */
  | { kind: "manual"; format: McpConfigFormat };

type CodingAgent = { codingAgentName: string; mcp: McpConfigMethod };

/** Everything setup knows about each coding agent, in one place. */
export const CODING_AGENTS: Readonly<Record<HarnessId, CodingAgent>> = {
  "claude-code": {
    codingAgentName: "Claude Code",
    mcp: {
      kind: "claude-cli",
      reload:
        "restart Claude Code, or reconnect it with /mcp, to load the Lemma tools",
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
  },
  pi: {
    codingAgentName: "Pi",
    mcp: {
      kind: "file",
      path: piConfigPath,
      format: mcpServersJson,
      reload: "run /reload in Pi to load the Lemma tools",
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
  },
  opencode: {
    codingAgentName: "OpenCode",
    mcp: {
      kind: "file",
      path: opencodeConfigPath,
      format: opencodeJson,
      reload: "restart OpenCode to load the Lemma tools",
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
  },
  other: {
    codingAgentName: "your coding agent",
    mcp: { kind: "manual", format: mcpServersJson },
  },
};
