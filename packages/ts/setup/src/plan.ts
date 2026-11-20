import { join } from "node:path";

import type { LemmaApiUrl } from "./api.js";
import type { SetupEnvironment } from "./context.js";
import {
  appEnvFor,
  planEnvExample,
  planEnvTarget,
  plannedEnvNote,
  plannedExampleNote,
  type AppEnv,
  type EnvExamplePlan,
  type EnvTarget,
} from "./env-file.js";
import type { HarnessId } from "./harness.js";
import {
  planMcpTarget,
  plannedMcpNote,
  type McpTarget,
} from "./mcp/targets.js";
import type { SetupPaths } from "./setup-paths.js";

/**
 * Where each file setup writes goes, and what it writes for the app,
 * decided before the one-time exchange.
 */
export type SetupPlan = {
  env: EnvTarget;
  example: EnvExamplePlan;
  mcp: McpTarget;
  appEnv: AppEnv;
};

/**
 * Plans every local write before the exchange, since the approved keys are
 * returned once. A target setup will not write is planned as its private
 * file or a skip, and `plannedNotes` announces it before approval.
 */
export async function plan(input: {
  environment: SetupEnvironment;
  appDir: string;
  harness: HarnessId;
  paths: SetupPaths;
  apiUrl: LemmaApiUrl;
}): Promise<SetupPlan> {
  const { environment, appDir, harness, paths } = input;
  const [env, example, mcp] = await Promise.all([
    planEnvTarget(join(appDir, ".env"), paths.savedKeys),
    planEnvExample(join(appDir, ".env.example")),
    planMcpTarget({
      harness,
      appDir,
      homeDir: environment.homeDir,
      env: environment.env,
      run: environment.run,
      paths,
    }),
  ]);
  return { env, example, mcp, appEnv: appEnvFor(input.apiUrl) };
}

/** What setup will skip or save elsewhere, said before approval. */
export function plannedNotes(setupPlan: SetupPlan): string[] {
  return [
    plannedEnvNote(setupPlan.env, setupPlan.appEnv),
    plannedExampleNote(setupPlan.example),
    plannedMcpNote(setupPlan.mcp),
  ].filter((note): note is string => note !== null);
}
