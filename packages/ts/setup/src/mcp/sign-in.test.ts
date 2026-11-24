import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CODING_AGENTS } from "../agents.js";
import type { RunCommand } from "../command.js";
import { HARNESS_IDS } from "../harness.js";
import { shellWord } from "../shell.js";
import { notKept, plan, scriptedRun } from "../testing/mcp.js";
import { temporaryDirectories } from "../testing/temp.js";
import { signInToMcp } from "./sign-in.js";

const tempDir = temporaryDirectories("lemma-setup-sign-in-");

/** A terminal that records what setup would run and prints, and runs nothing. */
function terminal(interactive: boolean) {
  const lines: string[] = [];
  const calls: Array<{ argv: string[]; cwd: string }> = [];
  return {
    lines,
    calls,
    environment: {
      interactive,
      output: (line: string) => lines.push(line),
      runInteractive: async (
        command: string,
        args: readonly string[],
        cwd: string,
      ) => {
        calls.push({ argv: [command, ...args], cwd });
        return { kind: "exited" as const, code: 0 };
      },
    },
  };
}

describe("signing in to Lemma's MCP server", () => {
  it("uses each coding agent's documented sign-in for the lemma server", () => {
    const commands = Object.fromEntries(
      HARNESS_IDS.map((harness) => {
        const { command } = CODING_AGENTS[harness].signIn;
        return [harness, command && [command.command, ...command.args]];
      }),
    );
    expect(commands).toEqual({
      "claude-code": ["claude", "mcp", "login", "lemma"],
      cursor: ["agent", "mcp", "login", "lemma"],
      pi: ["pi", "mcp", "login", "lemma"],
      codex: ["codex", "mcp", "login", "lemma"],
      opencode: ["opencode", "mcp", "auth", "lemma"],
      hermes: ["hermes", "mcp", "login", "lemma"],
      openclaw: ["openclaw", "mcp", "login", "lemma"],
      other: null,
    });
  });

  it("runs Claude Code's sign-in from the project root its local scope is keyed by", async () => {
    const home = await tempDir();
    const { run } = scriptedRun();
    const gitRun: RunCommand = async (command, args, cwd) =>
      command === "git"
        ? { code: 0, stdout: `${home}\n`, stderr: "" }
        : run(command, args, cwd);
    const appDir = join(home, "apps", "web");
    const { signIn } = notKept(
      await plan("claude-code", home, { run: gitRun, appDir }),
    );
    expect(signIn.cwd).toBe(home);
    const at = terminal(true);
    await signInToMcp({ signIn, environment: at.environment });
    expect(at.calls).toEqual([
      { argv: ["claude", "mcp", "login", "lemma"], cwd: home },
    ]);
    expect(at.lines).toEqual([
      "MCP: signing in to Lemma with `claude mcp login lemma`…",
      "MCP: signed in to Lemma.",
    ]);
  });

  it("prints the command and the step inside the agent when no person is at the terminal", async () => {
    const home = await tempDir();
    const { signIn } = notKept(await plan("opencode", home));
    const at = terminal(false);
    await signInToMcp({ signIn, environment: at.environment });
    expect(at.calls).toEqual([]);
    expect(at.lines).toEqual([
      `MCP: to sign in to Lemma as yourself, run \`(cd ${shellWord(home)} && opencode mcp auth lemma)\` in a terminal, or run /mcps in OpenCode, select \`lemma\`, and sign in.`,
    ]);
  });
});
