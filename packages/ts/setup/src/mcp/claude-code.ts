import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunCommand } from "../command.js";
import { gitRoot } from "../git.js";
import type { Placement, PrivateTarget } from "../placement.js";
import { isRecord } from "../shared.js";
import {
  existingKeyOf,
  headersOf,
  MCP_SERVER_NAME,
  parseJsonObject,
  UnsupportedConfigError,
  type ExistingMcpKey,
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
 * has a `url`.
 */
function claudeCodeEntry(url: string, apiKey: string): Record<string, unknown> {
  return { type: "http", url, headers: headersOf(apiKey) };
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
};

/** Claude Code's part of a `claude-cli` target: what placing with the command needs. */
export type ClaudeCliPlan = {
  kind: "claude-cli";
  destination: ClaudeLocalScope;
  reload: string;
  /** The key the local-scope `lemma` entry holds. */
  existing: ExistingMcpKey;
  /** The local-scope `lemma` entry as it is, restored if replacing it fails. */
  previousEntry: Record<string, unknown> | null;
};

/** Claude Code's plan: the command, or the private file and why. */
export type ClaudeCodePlan =
  | ClaudeCliPlan
  | (PrivateTarget & { destination: ClaudeLocalScope });

type LocalEntry =
  | { kind: "not-editable"; reason: string }
  | { kind: "read"; entry: Record<string, unknown> | null };

/**
 * The local-scope `lemma` entry Claude Code holds for the project. A missing
 * config holds none; one setup cannot read at all fails `start`, like the
 * other agents' configs.
 */
async function claudeLocalEntry(scope: ClaudeLocalScope): Promise<LocalEntry> {
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
 * Plans Claude Code's target: the `claude` command in the project's local
 * scope, or the private file when the command is missing or Claude Code's
 * config cannot be read safely.
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
  const destination: ClaudeLocalScope = {
    kind: "claude-local-scope",
    projectRoot: root ?? input.appDir,
    claudeConfig: claudeConfigPath(input),
  };
  if (version.code !== 0) {
    return {
      kind: "private",
      destination,
      reason: "the `claude` command is not on PATH",
    };
  }
  const local = await claudeLocalEntry(destination);
  if (local.kind === "not-editable") {
    return { kind: "private", destination, reason: local.reason };
  }
  return {
    kind: "claude-cli",
    destination,
    reload: input.reload,
    existing: existingKeyOf(local.entry, "headers"),
    previousEntry: local.entry,
  };
}

export function claudeScopeName(scope: ClaudeLocalScope): string {
  return `Claude Code's local scope for ${scope.projectRoot}`;
}

/** The private file's contents: the bare entry `claude mcp add-json` takes. */
export function claudeSavedEntry(url: string, apiKey: string): string {
  return `${JSON.stringify(claudeCodeEntry(url, apiKey), null, 2)}\n`;
}

/** Quoted for a POSIX shell, so a printed command runs as shown for any path. */
function shellQuoted(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * How to add the private file's entry. The command reads the key from the
 * file, so it never appears in the output, shell history, or a coding
 * agent's transcript. Every step waits on that read, so running it again
 * after the file is gone changes nothing. Like setup, it removes an
 * existing `lemma` server first, since Claude Code refuses a second one,
 * and it deletes the file once the add succeeds. The subshell keeps `cd`
 * and `entry` out of the caller's shell.
 */
export function claudeAddSavedEntryLines(
  scope: ClaudeLocalScope,
  savedPath: string,
): string[] {
  const file = shellQuoted(savedPath);
  return [
    `Add it to ${claudeScopeName(scope)}, not the committed \`.mcp.json\`, with this command. It replaces any \`${MCP_SERVER_NAME}\` server there, deletes that file once the new one is added, and changes nothing once that file is gone:`,
    `(cd ${shellQuoted(scope.projectRoot)} && entry="$(cat ${file})" && { claude mcp remove ${MCP_SERVER_NAME} --scope local >/dev/null 2>&1; claude mcp add-json ${MCP_SERVER_NAME} "$entry" --scope local; } && rm ${file})`,
    `Or, with Claude Code closed, add it as \`projects[${JSON.stringify(scope.projectRoot)}].mcpServers.${MCP_SERVER_NAME}\` in ${scope.claudeConfig}, then delete that file.`,
  ];
}

function redacted(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => result.split(secret).join("[redacted]"),
    text,
  );
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
  apiKey: string,
  run: RunCommand,
): Promise<Placement> {
  const { existing } = target;
  const secrets = [apiKey, ...(existing.kind === "key" ? [existing.key] : [])];
  const outputOf = (result: { stdout: string; stderr: string }) =>
    redacted(`${result.stdout}${result.stderr}`, secrets).trim();
  const { projectRoot } = target.destination;
  const claude = (args: string[]) => run("claude", args, projectRoot);
  // The same command the private file's instructions print.
  const addJson = (entry: Record<string, unknown>) =>
    claude([
      "mcp",
      "add-json",
      MCP_SERVER_NAME,
      JSON.stringify(entry),
      "--scope",
      "local",
    ]);
  const placed = (verb: string): Placement => ({
    placed: true,
    lines: [
      `MCP: ${verb} the \`${MCP_SERVER_NAME}\` server in Claude Code for ${projectRoot} (local scope).`,
      `MCP: ${target.reload}.`,
    ],
  });

  if (target.previousEntry === null) {
    const added = await addJson(claudeCodeEntry(url, apiKey));
    return added.code === 0
      ? placed("added")
      : {
          placed: false,
          reason: `Claude Code did not add the Lemma MCP server (${outputOf(added)})`,
        };
  }
  const removed = await claude([
    "mcp",
    "remove",
    MCP_SERVER_NAME,
    "--scope",
    "local",
  ]);
  if (removed.code !== 0) {
    return {
      placed: false,
      reason: `Claude Code did not remove its existing \`${MCP_SERVER_NAME}\` server, so that server is unchanged (${outputOf(removed)})`,
    };
  }
  const added = await addJson(claudeCodeEntry(url, apiKey));
  if (added.code === 0) return placed("replaced");
  const restored = await addJson(target.previousEntry);
  return {
    placed: false,
    reason: `Claude Code did not accept the new Lemma MCP server (${outputOf(added)}); ${restored.code === 0 ? "setup restored the previous" : "setup could not restore the previous"} \`${MCP_SERVER_NAME}\` server`,
  };
}
