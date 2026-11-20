import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Where each coding agent keeps its user-level MCP config. The environment
 * variables are the ones the agents and this repo's plugins already honor.
 */
export type ConfigLocationInput = {
  homeDir: string;
  env: NodeJS.ProcessEnv;
};

export function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

export function cursorConfigPath({ homeDir }: ConfigLocationInput): string {
  return join(homeDir, ".cursor", "mcp.json");
}

export function piConfigPath({ homeDir }: ConfigLocationInput): string {
  return join(homeDir, ".pi", "agent", "mcp.json");
}

export function codexConfigPath({ homeDir, env }: ConfigLocationInput): string {
  return join(
    configured(env.CODEX_HOME) ?? join(homeDir, ".codex"),
    "config.toml",
  );
}

export function hermesConfigPath({
  homeDir,
  env,
}: ConfigLocationInput): string {
  return join(
    configured(env.HERMES_HOME) ?? join(homeDir, ".hermes"),
    "config.yaml",
  );
}

/** `opencode.json`, or `opencode.jsonc` when only that one exists. */
export function opencodeConfigPath({
  homeDir,
  env,
}: ConfigLocationInput): string {
  const xdgConfigHome = configured(env.XDG_CONFIG_HOME);
  const directory =
    configured(env.OPENCODE_CONFIG_DIR) ??
    (xdgConfigHome
      ? join(xdgConfigHome, "opencode")
      : join(homeDir, ".config", "opencode"));
  const json = join(directory, "opencode.json");
  const jsonc = join(directory, "opencode.jsonc");
  return !existsSync(json) && existsSync(jsonc) ? jsonc : json;
}

export function openclawConfigPath({
  homeDir,
  env,
}: ConfigLocationInput): string {
  const explicit = configured(env.OPENCLAW_CONFIG_PATH);
  if (explicit) return explicit;
  const stateDir = configured(env.OPENCLAW_STATE_DIR);
  if (stateDir) return join(stateDir, "openclaw.json");
  const home = configured(env.OPENCLAW_HOME) ?? homeDir;
  const current = join(home, ".openclaw");
  const legacy = join(home, ".clawdbot");
  const directory =
    existsSync(current) || !existsSync(legacy) ? current : legacy;
  return join(directory, "openclaw.json");
}
