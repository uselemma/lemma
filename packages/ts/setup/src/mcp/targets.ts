import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { CODING_AGENTS } from "../agents.js";
import type { RunCommand } from "../command.js";
import { failureReason } from "../errors.js";
import {
  inspectFile,
  othersCanRead,
  othersCanReadWarning,
  PRIVATE_FILE_MODE,
  writeFileAtomic,
  writePrivateFile,
} from "../files.js";
import type { HarnessId } from "../harness.js";
import type { Placement, PrivateSave, PrivateTarget } from "../placement.js";
import type { SetupPaths } from "../setup-paths.js";
import {
  claudeAddSavedEntryLines,
  claudeSavedEntry,
  claudeScopeName,
  placeWithClaude,
  planClaudeCode,
  type ClaudeCliPlan,
  type ClaudeLocalScope,
} from "./claude-code.js";
import {
  MCP_SERVER_NAME,
  NO_EXISTING_KEY,
  UnsupportedConfigError,
  type ExistingMcpKey,
  type McpConfigFormat,
  type ParsedMcpConfig,
} from "./formats.js";
import type { ConfigLocationInput } from "./paths.js";

/** An agent's MCP servers, which take a new config in `format`. */
type McpServersDestination = { kind: "mcp-servers"; format: McpConfigFormat };

/**
 * Where the user adds the private file's entry, which also decides what the
 * file holds: a new config in `format`, or Claude Code's bare entry.
 */
type SavedEntryDestination = McpServersDestination | ClaudeLocalScope;

/** What every MCP target carries, set once at planning. */
export type McpTargetBase = {
  codingAgentName: string;
  /** The key the target already holds for Lemma. */
  existing: ExistingMcpKey;
  /**
   * The private file the key goes to: the plan for a private target, and
   * the fallback when another target's write fails.
   */
  fallbackPath: string;
  destination: SavedEntryDestination;
};

type ClaudeCliTarget = McpTargetBase & ClaudeCliPlan;

type McpFileTarget = McpTargetBase & {
  kind: "file";
  /** The config's format, which the private file shares. */
  destination: McpServersDestination;
  path: string;
  reload: string;
};

/**
 * Where the admin key goes, decided before the handshake starts; `private`
 * announces the private file up front.
 */
export type McpTarget =
  | ClaudeCliTarget
  | McpFileTarget
  | (McpTargetBase & PrivateTarget);

/** A target setup writes the admin key into. */
export type PlaceableMcpTarget = Exclude<McpTarget, PrivateTarget>;

/** The Lemma MCP server's URL for a Lemma API URL. */
export function mcpServerUrl(apiUrl: string): string {
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

/** The private file for one destination: what it holds, and where and how the user adds it. */
type SavedEntry = {
  fileExtension: string;
  contents(url: string, apiKey: string): string;
  /** Where the entry goes, as the planned note and the saved lines both name it. */
  destinationName: string;
  addLines(savedPath: string): string[];
};

function savedEntryOf(
  destination: SavedEntryDestination,
  codingAgentName: string,
): SavedEntry {
  if (destination.kind === "claude-local-scope") {
    return {
      fileExtension: "json",
      contents: claudeSavedEntry,
      destinationName: claudeScopeName(destination),
      addLines: (savedPath) => claudeAddSavedEntryLines(destination, savedPath),
    };
  }
  const destinationName = `${codingAgentName}'s MCP servers`;
  return {
    fileExtension: destination.format.fileExtension,
    contents: (url, apiKey) =>
      destination.format.parse(null).set(url, apiKey).contents,
    destinationName,
    addLines: () => [`Add it to ${destinationName}, then delete that file.`],
  };
}

/**
 * Picks the MCP target and reads what it already holds. A config whose
 * contents or kind setup cannot edit is planned as the private file; one it
 * cannot read at all (for example `EACCES`) fails `start`.
 */
export async function planMcpTarget(
  input: ConfigLocationInput & {
    harness: HarnessId;
    appDir: string;
    run: RunCommand;
    paths: SetupPaths;
  },
): Promise<McpTarget> {
  const agent = CODING_AGENTS[input.harness];
  const baseFor = <Destination extends SavedEntryDestination>(
    destination: Destination,
  ): McpTargetBase & { destination: Destination } => ({
    codingAgentName: agent.codingAgentName,
    existing: NO_EXISTING_KEY,
    fallbackPath: input.paths.savedMcpEntry(
      input.harness,
      savedEntryOf(destination, agent.codingAgentName).fileExtension,
    ),
    destination,
  });
  switch (agent.mcp.kind) {
    case "claude-cli": {
      const plan = await planClaudeCode({ ...input, reload: agent.mcp.reload });
      return { ...baseFor(plan.destination), ...plan };
    }
    case "file": {
      const base = baseFor({ kind: "mcp-servers", format: agent.mcp.format });
      const path = agent.mcp.path(input);
      const config = await readMcpConfig(path, base.destination.format);
      return config.kind === "not-editable"
        ? { ...base, kind: "private", reason: config.reason }
        : {
            ...base,
            kind: "file",
            path,
            reload: agent.mcp.reload,
            existing: config.parsed.existing,
          };
    }
    case "manual":
      return {
        ...baseFor({ kind: "mcp-servers", format: agent.mcp.format }),
        kind: "private",
        reason: `setup has no documented MCP config format for ${agent.codingAgentName}`,
      };
  }
}

/** The line announcing that the admin key will go to its private file. */
export function plannedMcpNote(target: McpTarget): string | null {
  return target.kind === "private"
    ? `MCP: ${target.reason}. After approval, setup saves the Lemma server's entry to ${target.fallbackPath} (readable only by you) for you to add to ${savedEntryOf(target.destination, target.codingAgentName).destinationName}.`
    : null;
}

export function keptMcpLines(target: McpTarget): string[] {
  return [
    `MCP: kept ${target.codingAgentName}'s \`${MCP_SERVER_NAME}\` server; its key is already an admin key for this organization.`,
  ];
}

export function missingMcpLine(target: McpTarget): string {
  return `MCP: Lemma returned no admin key, and ${target.codingAgentName}'s MCP config holds none it confirmed. Run \`start\` again.`;
}

async function placeInFile(
  target: McpFileTarget,
  url: string,
  apiKey: string,
): Promise<Placement> {
  const config = await readMcpConfig(target.path, target.destination.format);
  if (config.kind === "not-editable") {
    return { placed: false, reason: config.reason };
  }
  const result = config.parsed.set(url, apiKey);
  await mkdir(dirname(target.path), { recursive: true });
  await writeFileAtomic(
    target.path,
    result.contents,
    config.mode ?? PRIVATE_FILE_MODE,
  );
  return {
    placed: true,
    lines: [
      `MCP: ${result.replaced ? "replaced" : "added"} the \`${MCP_SERVER_NAME}\` server in ${target.path}.`,
      ...(config.mode !== null && othersCanRead(config.mode)
        ? [othersCanReadWarning(target.path, config.mode, "the admin key")]
        : []),
      `MCP: ${target.reload}.`,
    ],
  };
}

/** Places the admin key in the agent's config, or says why not. */
export async function placeMcpKey(input: {
  target: PlaceableMcpTarget;
  url: string;
  apiKey: string;
  run: RunCommand;
}): Promise<Placement> {
  const { target, url, apiKey } = input;
  try {
    return target.kind === "file"
      ? await placeInFile(target, url, apiKey)
      : await placeWithClaude(target, url, apiKey, input.run);
  } catch (error) {
    // Only I/O reaches here: content setup cannot edit is a placement reason.
    return {
      placed: false,
      reason: `setup could not place the Lemma MCP server (${failureReason(error)})`,
    };
  }
}

/**
 * Saves the entry, key included, where only the user can read it, and
 * prints where to add it and its shape without the key.
 */
export async function saveMcpEntryPrivately(input: {
  target: McpTarget;
  url: string;
  apiKey: string;
  reason: string;
}): Promise<PrivateSave> {
  const { target, url, reason } = input;
  const entry = savedEntryOf(target.destination, target.codingAgentName);
  try {
    await writePrivateFile(
      target.fallbackPath,
      entry.contents(url, input.apiKey),
    );
  } catch (error) {
    return {
      saved: false,
      lines: [
        `MCP: ${reason}, and setup could not save the admin key (${failureReason(error)}). Run \`start\` again.`,
      ],
    };
  }
  return {
    saved: true,
    lines: [
      `MCP: ${reason}. The full entry, key included, is in ${target.fallbackPath} (readable only by you).`,
      ...entry.addLines(target.fallbackPath),
      "The entry has this shape:",
      entry.contents(url, "lemma_admin_key_from_the_file_above").trimEnd(),
    ],
  };
}
