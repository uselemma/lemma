import type { CommandResult, RunCommand } from "../command.js";
import type { HarnessId } from "../harness.js";
import { placeMcpKey, planMcpTarget, type McpTarget } from "../mcp/targets.js";
import { setupPaths } from "../setup-paths.js";

const API_URL = "https://api.uselemma.ai";
export const URL_ = `${API_URL}/mcp/`;
export const KEY = "lemma_sk_admin_0123456789abcdef";
export const OLD = "lemma_sk_old_admin_0123456789";

const ok: CommandResult = { code: 0, stdout: "", stderr: "" };

/** Answers each command by its first two arguments, in order of the given lists. */
export function scriptedRun(answers: Record<string, CommandResult[]> = {}) {
  const calls: Array<{ argv: string[]; cwd: string }> = [];
  const run: RunCommand = async (command, args, cwd) => {
    calls.push({ argv: [command, ...args], cwd });
    if (command === "git") return { code: 128, stdout: "", stderr: "" };
    return answers[args.slice(0, 2).join(" ")]?.shift() ?? ok;
  };
  const claudeCalls = () =>
    calls.filter(
      (call) => call.argv[0] === "claude" && call.argv[1] !== "--version",
    );
  return { run, calls, claudeCalls };
}

export function saved(
  home: string,
  harness: HarnessId,
  extension: string,
  appDir = home,
): string {
  return setupPaths(home, appDir).savedMcpEntry(harness, extension);
}

export async function plan(
  harness: HarnessId,
  home: string,
  extra: { env?: NodeJS.ProcessEnv; run?: RunCommand; appDir?: string } = {},
): Promise<McpTarget> {
  const appDir = extra.appDir ?? home;
  return planMcpTarget({
    harness,
    homeDir: home,
    env: extra.env ?? {},
    appDir,
    run: extra.run ?? scriptedRun().run,
    paths: setupPaths(home, appDir),
  });
}

export async function place(
  target: McpTarget,
  run: RunCommand = scriptedRun().run,
) {
  if (target.kind === "private")
    throw new Error("a private target is not placed");
  return placeMcpKey({ target, url: URL_, apiKey: KEY, run });
}
