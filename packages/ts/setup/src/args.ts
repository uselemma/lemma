import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import { DEFAULT_API_URL, lemmaApiUrl, type LemmaApiUrl } from "./api.js";
import { EXIT_CODES, failureReason, SetupError } from "./errors.js";
import { HARNESS_IDS, isHarnessId } from "./harness.js";
import { WAIT_BUDGET_SECONDS } from "./poll.js";
import { isUuid } from "./shared.js";
import type { StartOptions } from "./start.js";

export const USAGE = [
  "Usage:",
  "  npx @uselemma/setup start --harness <id> --project-name <name> --agent-name <name> [options]",
  "  npx @uselemma/setup wait",
  "",
  "Connects this app and its coding agent to Lemma. `start` begins a browser",
  "approval and returns at once. `wait` checks for the approval for up to",
  `${WAIT_BUDGET_SECONDS} seconds; run it again while it exits with 5. Once approved, it`,
  "writes LEMMA_API_KEY and LEMMA_PROJECT_ID to ./.env, with LEMMA_BASE_URL when",
  "--api-url isn't production, and the Lemma MCP server to the coding agent's",
  "config. Run both in the app's directory.",
  "",
  "start, required:",
  `  --harness <id>          The coding agent running setup: ${HARNESS_IDS.join(", ")}`,
  "  --project-name <name>   The Lemma project name to propose",
  "  --agent-name <name>     The agent name to propose (the root trace name), e.g. support-bot",
  "",
  "start, optional:",
  "  --org <slug>            The Lemma organization to approve in, e.g. acme-inc-x1y2",
  "  --project-id <id>       The ID of an existing Lemma project for the approval page to",
  "                          select, from the setup prompt's Lemma project line",
  "  --repository <repo>     The repository, e.g. acme/support-bot",
  "  --framework <name>      The agent framework, e.g. vercel-ai, langgraph",
  "  --api-url <url>         The Lemma API (default https://api.uselemma.ai): HTTPS on",
  "                          uselemma.ai or a subdomain, or HTTP/HTTPS on localhost,",
  "                          127.0.0.1 or [::1]",
  "  --no-browser            Print the approval URL without opening a browser",
  "",
  "  --help                  Show this help",
  "  --version               Show the package version",
  "",
  "Exit codes: 0 done, 1 failed, 2 usage error, 3 code expired, 4 approval denied,",
  "5 approval still pending (run wait again).",
].join("\n");

/** The API's limit on each inferred value and on the organization slug. */
const INFERRED_VALUE_MAX_CHARS = 200;

/** Agent names the platform treats as "no name" and refuses at approval. */
const RESERVED_AGENT_NAMES = new Set(["trace"]);

type ParsedCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "start"; options: StartOptions }
  | { kind: "wait" };

function usageError(message: string): SetupError {
  return new SetupError(`${message}\n\n${USAGE}`, EXIT_CODES.usage);
}

/** Strict parsing typed by the option spec; any parse error is a usage error. */
function parse<const Options extends ParseArgsOptionsConfig>(
  args: string[],
  options: Options,
) {
  try {
    return parseArgs({ args, strict: true, allowPositionals: false, options })
      .values;
  } catch (error) {
    throw usageError(error instanceof Error ? error.message : String(error));
  }
}

function requiredValue(flag: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw usageError(`${flag} is required and cannot be empty`);
  if (trimmed.length > INFERRED_VALUE_MAX_CHARS) {
    throw usageError(
      `${flag} is longer than ${INFERRED_VALUE_MAX_CHARS} characters`,
    );
  }
  return trimmed;
}

/** An optional flag given as an empty string counts as absent, like `--api-url ""`. */
function optionalValue(
  flag: string,
  value: string | undefined,
): string | undefined {
  return value === undefined || value.trim() === ""
    ? undefined
    : requiredValue(flag, value);
}

/** The approval page applies the same slug rule; a name that slugs to nothing cannot be approved. */
function agentNameSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A repository URL without credentials: a remote URL can embed a token. */
export function repositoryWithoutCredentials(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

const GLOBAL_OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const;

const START_OPTIONS = {
  ...GLOBAL_OPTIONS,
  harness: { type: "string" },
  "project-name": { type: "string" },
  "agent-name": { type: "string" },
  org: { type: "string" },
  "project-id": { type: "string" },
  repository: { type: "string" },
  framework: { type: "string" },
  "api-url": { type: "string" },
  "no-browser": { type: "boolean" },
} as const;

/** Parses and validates the command line; every problem is a usage error (exit 2). */
export function parseCommand(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command.startsWith("-")) {
    const values = parse(argv, GLOBAL_OPTIONS);
    if (values.version) return { kind: "version" };
    if (values.help) return { kind: "help" };
    throw usageError("Choose a command: start or wait");
  }
  if (command === "wait") {
    return parse(rest, GLOBAL_OPTIONS).help
      ? { kind: "help" }
      : { kind: "wait" };
  }
  if (command !== "start") throw usageError(`Unknown command: ${command}`);

  const values = parse(rest, START_OPTIONS);
  if (values.help) return { kind: "help" };
  const harness = values.harness?.trim();
  if (harness === undefined || !isHarnessId(harness)) {
    throw usageError(`--harness must be one of: ${HARNESS_IDS.join(", ")}`);
  }
  const agentName = requiredValue("--agent-name", values["agent-name"]);
  const slug = agentNameSlug(agentName);
  if (!slug || RESERVED_AGENT_NAMES.has(slug)) {
    throw usageError(
      `--agent-name "${agentName}" cannot be an agent name; use letters or digits, for example support-bot`,
    );
  }
  const org = optionalValue("--org", values.org);
  if (org !== undefined && /\s/.test(org)) {
    throw usageError(
      "--org is the organization's slug, for example acme-inc-x1y2",
    );
  }
  const projectId = optionalValue("--project-id", values["project-id"]);
  if (projectId !== undefined && !isUuid(projectId)) {
    throw usageError(
      "--project-id is the project's ID from the setup prompt, for example 0b7c2f1e-4d3a-4f6b-9c8d-1a2b3c4d5e6f",
    );
  }
  const repository = optionalValue("--repository", values.repository);
  let apiUrl: LemmaApiUrl;
  try {
    apiUrl = lemmaApiUrl(
      values["api-url"]?.trim() || DEFAULT_API_URL,
      "--api-url",
    );
  } catch (error) {
    throw usageError(failureReason(error));
  }
  return {
    kind: "start",
    options: {
      harness,
      projectName: requiredValue("--project-name", values["project-name"]),
      agentName,
      openBrowser: values["no-browser"] !== true,
      apiUrl,
      repository:
        repository === undefined
          ? undefined
          : repositoryWithoutCredentials(repository),
      framework: optionalValue("--framework", values.framework),
      org,
      projectId,
    },
  };
}
