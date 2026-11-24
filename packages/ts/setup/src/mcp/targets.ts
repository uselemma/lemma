import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { CODING_AGENTS } from "../agents.js";
import type { LemmaApiUrl } from "../api.js";
import type { RunCommand } from "../command.js";
import { failureReason } from "../errors.js";
import { inspectFile, PRIVATE_FILE_MODE, writeFileAtomic } from "../files.js";
import type { HarnessId } from "../harness.js";
import type { Placement } from "../placement.js";
import {
  claudeAddCommandLines,
  claudeScopeName,
  placeWithClaude,
  planClaudeCode,
  type ClaudeCliPlan,
  type ClaudeLocalScope,
} from "./claude-code.js";
import {
  MCP_SERVER_NAME,
  UnsupportedConfigError,
  type McpConfigFormat,
  type ParsedMcpConfig,
} from "./formats.js";
import type { ConfigLocationInput } from "./paths.js";
import { signInInstruction, type PlannedSignIn } from "./sign-in.js";

/** An agent's MCP servers, which take a new config in `format`. */
type McpServersDestination = { kind: "mcp-servers"; format: McpConfigFormat };

/**
 * Where the person adds the `lemma` server when setup cannot, which also
 * decides what setup prints: a config in `format`, or Claude Code's command.
 */
type ManualDestination = McpServersDestination | ClaudeLocalScope;

/** What every target setup writes or prints carries, set once at planning. */
type McpTargetBase = {
  codingAgentName: string;
  destination: ManualDestination;
  signIn: PlannedSignIn;
};

type ClaudeCliTarget = McpTargetBase & ClaudeCliPlan;

type McpFileTarget = McpTargetBase & {
  kind: "file";
  /** The config's format, which the printed entry shares. */
  destination: McpServersDestination;
  path: string;
  reload: string;
};

/**
 * A target setup does not write: it prints the `lemma` server for the person
 * to add. `reason` is a clause the line that prints it ends.
 */
type ManualTarget = McpTargetBase & { kind: "manual"; reason: string };

/**
 * An agent whose `lemma` server already sends an API key: setup leaves it as
 * it is, since API keys keep working for MCP, and it needs no sign-in.
 */
type KeptTarget = { kind: "kept"; codingAgentName: string };

/** Where the `lemma` server goes, decided before the handshake starts. */
export type McpTarget =
  | ClaudeCliTarget
  | McpFileTarget
  | ManualTarget
  | KeptTarget;

/** A target setup writes the `lemma` server into. */
export type PlaceableMcpTarget = ClaudeCliTarget | McpFileTarget;

/** The Lemma MCP server's URL for a Lemma API URL. */
export function mcpServerUrl(apiUrl: LemmaApiUrl): string {
  return `${apiUrl}/mcp/`;
}

/** An MCP config as setup sees it: one it may edit (or create), or not, and why. */
type McpConfigFile =
  | { kind: "not-editable"; reason: string }
  | { kind: "editable"; parsed: ParsedMcpConfig; mode: number | null };

/**
 * The one reader of an agent's MCP config, for planning and for writing.
 * Content setup cannot edit becomes `not-editable` here; only a failure to
 * read the file at all is thrown.
 */
async function readMcpConfig(
  path: string,
  format: McpConfigFormat,
): Promise<McpConfigFile> {
  const state = await inspectFile(path);
  if (state.kind === "not-editable") {
    return { kind: "not-editable", reason: notEditableReason(path, state.why) };
  }
  try {
    return state.kind === "file"
      ? {
          kind: "editable",
          parsed: format.parse(state.contents),
          mode: state.mode,
        }
      : { kind: "editable", parsed: format.parse(null), mode: null };
  } catch (error) {
    if (!(error instanceof UnsupportedConfigError)) throw error;
    return {
      kind: "not-editable",
      reason: notEditableReason(path, error.message),
    };
  }
}

/** `why` is a clause that reads after the path, such as "is a symlink". */
function notEditableReason(path: string, why: string): string {
  return `${path} ${why}, so setup does not edit it`;
}

/** Where the person adds the server by hand, as the planned note and the printed lines both name it. */
function destinationName(target: PlaceableMcpTarget | ManualTarget): string {
  return target.destination.kind === "claude-local-scope"
    ? claudeScopeName(target.destination)
    : `${target.codingAgentName}'s MCP servers`;
}

/**
 * Picks the MCP target and reads what it already holds. A `lemma` server
 * that sends a key is kept; a config whose contents or kind setup cannot
 * edit is planned as a manual add; one it cannot read at all (for example
 * `EACCES`) fails `start`.
 */
export async function planMcpTarget(
  input: ConfigLocationInput & {
    harness: HarnessId;
    appDir: string;
    run: RunCommand;
  },
): Promise<McpTarget> {
  const agent = CODING_AGENTS[input.harness];
  const { codingAgentName } = agent;
  const kept: KeptTarget = { kind: "kept", codingAgentName };
  const signIn = (cwd: string): PlannedSignIn => ({ ...agent.signIn, cwd });
  const serversBase = (format: McpConfigFormat) => {
    const destination: McpServersDestination = { kind: "mcp-servers", format };
    return { codingAgentName, destination, signIn: signIn(input.appDir) };
  };
  switch (agent.mcp.kind) {
    case "claude-cli": {
      const plan = await planClaudeCode({ ...input, reload: agent.mcp.reload });
      if (plan.kind === "kept") return kept;
      return {
        ...plan,
        codingAgentName,
        signIn: signIn(plan.destination.projectRoot),
      };
    }
    case "file": {
      const base = serversBase(agent.mcp.format);
      const path = agent.mcp.path(input);
      const config = await readMcpConfig(path, agent.mcp.format);
      if (config.kind === "not-editable") {
        return { ...base, kind: "manual", reason: config.reason };
      }
      if (config.parsed.sendsKey) return kept;
      return { ...base, kind: "file", path, reload: agent.mcp.reload };
    }
    case "manual":
      return {
        ...serversBase(agent.mcp.format),
        kind: "manual",
        reason: `setup has no documented MCP config format for ${codingAgentName}`,
      };
  }
}

/** What setup will leave alone or print, said before approval. */
export function plannedMcpNote(target: McpTarget): string | null {
  switch (target.kind) {
    case "manual":
      return `MCP: ${target.reason}. After approval, setup prints the \`${MCP_SERVER_NAME}\` server for you to add to ${destinationName(target)}.`;
    case "kept":
      return `MCP: ${target.codingAgentName}'s \`${MCP_SERVER_NAME}\` server sends an API key, so setup leaves it as it is.`;
    case "claude-cli":
    case "file":
      return null;
  }
}

export function keptMcpLine(codingAgentName: string): string {
  return `MCP: kept ${codingAgentName}'s \`${MCP_SERVER_NAME}\` server, which sends an API key. To sign in as yourself instead, remove that server and run setup again.`;
}

async function placeInFile(
  target: McpFileTarget,
  url: string,
): Promise<Placement> {
  const config = await readMcpConfig(target.path, target.destination.format);
  if (config.kind === "not-editable") {
    return { placed: false, reason: config.reason };
  }
  const result = config.parsed.set(url);
  await mkdir(dirname(target.path), { recursive: true });
  // A new config is owner-only: the agent keeps other servers' keys there.
  await writeFileAtomic(
    target.path,
    result.contents,
    config.mode ?? PRIVATE_FILE_MODE,
  );
  return {
    placed: true,
    lines: [
      `MCP: ${result.replaced ? "replaced" : "added"} the \`${MCP_SERVER_NAME}\` server in ${target.path}.`,
    ],
  };
}

/** Places the `lemma` server in the agent's config, or says why not. */
export async function placeMcpServer(input: {
  target: PlaceableMcpTarget;
  url: string;
  run: RunCommand;
}): Promise<Placement> {
  const { target, url } = input;
  try {
    return target.kind === "file"
      ? await placeInFile(target, url)
      : await placeWithClaude(target, url, input.run);
  } catch (error) {
    // Only I/O reaches here: content setup cannot edit is a placement reason.
    return {
      placed: false,
      reason: `setup could not place the Lemma MCP server (${failureReason(error)})`,
    };
  }
}

/**
 * The `lemma` server for the person to add by hand, and where, then how to
 * sign in. It holds no key: the coding agent signs in once it is added.
 */
export function manualMcpLines(input: {
  target: PlaceableMcpTarget | ManualTarget;
  url: string;
  reason: string;
}): string[] {
  const { target, url, reason } = input;
  const { destination } = target;
  const add =
    destination.kind === "claude-local-scope"
      ? [`MCP: ${reason}.`, ...claudeAddCommandLines(destination, url)]
      : [
          `MCP: ${reason}. Add this \`${MCP_SERVER_NAME}\` server to ${destinationName(target)}:`,
          destination.format.parse(null).set(url).contents.trimEnd(),
        ];
  return [
    ...add,
    `Once it's added, to sign in to Lemma as yourself, ${signInInstruction(target.signIn)}.`,
  ];
}
