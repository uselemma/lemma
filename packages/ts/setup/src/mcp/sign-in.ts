import type { McpSignIn } from "../agents.js";
import type { SetupEnvironment } from "../context.js";
import { shellWord, shownCommand } from "../shell.js";

/**
 * The agent's sign-in for this run, with the directory its command runs
 * from: the project root for Claude Code, whose local scope holds the
 * server, and the app directory otherwise.
 */
export type PlannedSignIn = McpSignIn & { cwd: string };

/**
 * How to sign in, for a person to follow: the agent's command, from the
 * directory it runs in, and the step inside the agent, where each exists.
 */
export function signInInstruction(signIn: PlannedSignIn): string {
  const steps = [
    ...(signIn.command
      ? [
          `run \`(cd ${shellWord(signIn.cwd)} && ${shownCommand(signIn.command.command, signIn.command.args)})\` in a terminal`,
        ]
      : []),
    ...(signIn.inAgent ? [signIn.inAgent] : []),
  ];
  return steps.join(", or ");
}

/**
 * Signs the coding agent in to Lemma's MCP server once setup has written its
 * `lemma` server. With `run` (at a terminal, or `wait --sign-in`), setup runs
 * the agent's own sign-in command, which opens Lemma in the browser and
 * waits for the person; otherwise it prints how. A sign-in that does not
 * finish leaves the server in place and prints how to sign in later, since
 * the agent can sign in at any time.
 */
export async function signInToMcp(input: {
  signIn: PlannedSignIn;
  run: boolean;
  environment: Pick<SetupEnvironment, "runInteractive" | "output">;
}): Promise<void> {
  const { signIn, run, environment } = input;
  const later = `to sign in to Lemma as yourself, ${signInInstruction(signIn)}`;
  if (!signIn.command || !run) {
    environment.output(`MCP: ${later}.`);
    return;
  }
  const { command, args } = signIn.command;
  const shown = shownCommand(command, args);
  environment.output(`MCP: signing in to Lemma with \`${shown}\`…`);
  const result = await environment.runInteractive(command, args, signIn.cwd);
  if (result.kind === "exited" && result.code === 0) {
    environment.output("MCP: signed in to Lemma.");
    return;
  }
  const why =
    result.kind === "not-started"
      ? `\`${command}\` could not start`
      : result.kind === "signaled"
        ? `it was stopped by ${result.signal}`
        : `exit code ${result.code}`;
  environment.output(
    `MCP: \`${shown}\` did not finish (${why}). Later, ${later}.`,
  );
}
