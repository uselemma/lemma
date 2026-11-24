import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunCommand } from "../command.js";
import { gitRoot } from "../git.js";
import type { Placement } from "../placement.js";
import { isRecord } from "../shared.js";
import { shellWord, shownCommand } from "../shell.js";
import {
  MCP_SERVER_NAME,
  parseJsonObject,
  sendsKey,
  UnsupportedConfigError,
} from "./formats.js";
import { configured, type ConfigLocationInput } from "./paths.js";

/** Claude Code's user config, which holds its local scope. */
export function claudeConfigPath({
  homeDir,
  env,
}: ConfigLocationInput): string {
  return join(configured(env.CLAUDE_CONFIG_DIR) ?? homeDir, ".claude.json");
}

/**
 * One Claude Code server entry, as `claude mcp add-json` takes it: Claude
 * Code reads an entry without `type` as a stdio server and skips one that
 * has a `url`. Without a header, Claude Code signs in with OAuth when the
 * server answers 401.
 */
function claudeCodeEntry(url: string): Record<string, unknown> {
  return { type: "http", url };
}

/** The scope `claude mcp add-json` writes to, which stays out of the repository. */
export type ClaudeLocalScope = {
  kind: "claude-local-scope";
  /**
   * The physical path Claude Code keys its local scope by (the git root, or
   * the resolved app directory outside git), and the working directory for
   * setup's own `claude` commands.
   */
  projectRoot: string;
  claudeConfig: string;
  /**
   * The local-scope `lemma` entry planning read, which sends no key: what a
   * failed replace restores, and what a printed command removes first. Null
   * when there is none, or when Claude Code's config could not be read.
   */
  previousEntry: Record<string, unknown> | null;
};

/** Claude Code's part of a `claude-cli` target: what placing with the command needs. */
export type ClaudeCliPlan = {
  kind: "claude-cli";
  destination: ClaudeLocalScope;
  reload: string;
};

/**
 * Claude Code's plan: the command, a manual add and why, or nothing for a
 * local-scope `lemma` entry that sends an API key.
 */
export type ClaudeCodePlan =
  | ClaudeCliPlan
  | { kind: "manual"; reason: string; destination: ClaudeLocalScope }
  | { kind: "kept" };

type LocalEntry =
  | { kind: "not-editable"; reason: string }
  | { kind: "read"; entry: Record<string, unknown> | null };

/**
 * The local-scope `lemma` entry Claude Code holds for the project. A missing
 * config holds none; one setup cannot read at all fails `start`, like the
 * other agents' configs.
 */
async function claudeLocalEntry(
  scope: Pick<ClaudeLocalScope, "claudeConfig" | "projectRoot">,
): Promise<LocalEntry> {
  let contents: string;
  try {
    contents = await readFile(scope.claudeConfig, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "read", entry: null };
    }
    throw error;
  }
  let config: Record<string, unknown>;
  try {
    config = parseJsonObject(contents);
  } catch (error) {
    if (!(error instanceof UnsupportedConfigError)) throw error;
    return {
      kind: "not-editable",
      reason: `${scope.claudeConfig} is not valid JSON, so setup cannot read Claude Code's existing \`${MCP_SERVER_NAME}\` server`,
    };
  }
  const projects = config.projects;
  const project = isRecord(projects) ? projects[scope.projectRoot] : undefined;
  const servers = isRecord(project) ? project.mcpServers : undefined;
  const entry = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  return { kind: "read", entry: isRecord(entry) ? entry : null };
}

/**
 * Plans Claude Code's target: nothing when the local `lemma` entry sends a
 * key, which needs no `claude` command to read; otherwise the command in the
 * project's local scope, or a manual add when the command is missing or
 * Claude Code's config cannot be read safely.
 */
export async function planClaudeCode(
  input: ConfigLocationInput & {
    appDir: string;
    run: RunCommand;
    reload: string;
  },
): Promise<ClaudeCodePlan> {
  const [root, version] = await Promise.all([
    gitRoot(input.appDir, input.run),
    input.run("claude", ["--version"], input.appDir),
  ]);
  const projectRoot = root ?? input.appDir;
  const claudeConfig = claudeConfigPath(input);
  const local = await claudeLocalEntry({ claudeConfig, projectRoot });
  // `headersHelper` is Claude Code's command that produces the headers.
  if (
    local.kind === "read" &&
    sendsKey(local.entry, ["headers"], ["headersHelper"])
  ) {
    return { kind: "kept" };
  }
  const destination: ClaudeLocalScope = {
    kind: "claude-local-scope",
    projectRoot,
    claudeConfig,
    previousEntry: local.kind === "read" ? local.entry : null,
  };
  if (version.code !== 0) {
    return {
      kind: "manual",
      destination,
      reason: "the `claude` command is not on PATH",
    };
  }
  if (local.kind === "not-editable") {
    return { kind: "manual", destination, reason: local.reason };
  }
  return { kind: "claude-cli", destination, reload: input.reload };
}

export function claudeScopeName(scope: ClaudeLocalScope): string {
  return `Claude Code's local scope for ${scope.projectRoot}`;
}

/** The `claude mcp remove` arguments setup runs, and prints for a manual replace. */
const REMOVE_ARGS = ["mcp", "remove", MCP_SERVER_NAME, "--scope", "local"];

/** The `claude mcp add-json` arguments setup runs, and prints for a manual add. */
function addJsonArgs(entry: Record<string, unknown>): string[] {
  return [
    "mcp",
    "add-json",
    MCP_SERVER_NAME,
    JSON.stringify(entry),
    "--scope",
    "local",
  ];
}

/**
 * How to add the `lemma` server by hand: the commands setup runs, from the
 * project root, or the entry in Claude Code's config. With a local `lemma`
 * entry planning read, which sends no key, the command removes it first,
 * since Claude Code refuses a second entry of the same name; that removal
 * may find nothing, after a failed restore, so its failure is ignored. The
 * braces keep a failed `cd` from running either command elsewhere, and the
 * subshell keeps `cd` out of the caller's shell.
 */
export function claudeAddCommandLines(
  scope: ClaudeLocalScope,
  url: string,
): string[] {
  const entry = claudeCodeEntry(url);
  const root = shellWord(scope.projectRoot);
  const add = shownCommand("claude", addJsonArgs(entry));
  const server = `\`${MCP_SERVER_NAME}\` server`;
  const scopeName = claudeScopeName(scope);
  const [heading, command] =
    scope.previousEntry === null
      ? [`Add the ${server} to ${scopeName}`, `(cd ${root} && ${add})`]
      : [
          `Replace any ${server} in ${scopeName}`,
          `(cd ${root} && { ${shownCommand("claude", REMOVE_ARGS)} >/dev/null 2>&1; ${add}; })`,
        ];
  return [
    `${heading}, not the committed \`.mcp.json\`, with this command:`,
    command,
    `Or, with Claude Code closed, set \`projects[${JSON.stringify(scope.projectRoot)}].mcpServers.${MCP_SERVER_NAME}\` to ${JSON.stringify(entry)} in ${scope.claudeConfig}.`,
  ];
}

/**
 * Follows the plan. Without a local-scope `lemma` entry, the server is
 * added once and a refusal is final. With one, Claude Code refuses a second
 * entry of the same name, so the old entry is removed and the new one
 * added; only when the removal happened and that add fails is the old
 * entry restored.
 */
export async function placeWithClaude(
  target: ClaudeCliPlan,
  url: string,
  run: RunCommand,
): Promise<Placement> {
  const outputOf = (result: { stdout: string; stderr: string }) =>
    `${result.stdout}${result.stderr}`.trim();
  const { projectRoot } = target.destination;
  const claude = (args: string[]) => run("claude", args, projectRoot);
  // The same command a manual add prints.
  const addJson = (entry: Record<string, unknown>) =>
    claude(addJsonArgs(entry));
  const placed = (verb: string): Placement => ({
    placed: true,
    lines: [
      `MCP: ${verb} the \`${MCP_SERVER_NAME}\` server in Claude Code for ${projectRoot} (local scope).`,
    ],
  });

  const { previousEntry } = target.destination;
  if (previousEntry === null) {
    const added = await addJson(claudeCodeEntry(url));
    return added.code === 0
      ? placed("added")
      : {
          placed: false,
          reason: `Claude Code did not add the Lemma MCP server (${outputOf(added)})`,
        };
  }
  const removed = await claude(REMOVE_ARGS);
  if (removed.code !== 0) {
    return {
      placed: false,
      reason: `Claude Code did not remove its existing \`${MCP_SERVER_NAME}\` server, so that server is unchanged (${outputOf(removed)})`,
    };
  }
  const added = await addJson(claudeCodeEntry(url));
  if (added.code === 0) return placed("replaced");
  const restored = await addJson(previousEntry);
  return {
    placed: false,
    reason: `Claude Code did not accept the new Lemma MCP server (${outputOf(added)}); ${restored.code === 0 ? "setup restored the previous" : "setup could not restore the previous"} \`${MCP_SERVER_NAME}\` server`,
  };
}
