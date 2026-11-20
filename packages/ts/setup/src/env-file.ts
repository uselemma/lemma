import type { RunCommand } from "./command.js";
import { failureReason } from "./errors.js";
import {
  inspectFile,
  othersCanRead,
  othersCanReadWarning,
  PRIVATE_FILE_MODE,
  writeFileAtomic,
  writePrivateFile,
  type NotEditableWhy,
} from "./files.js";
import { isGitIgnored } from "./git.js";
import type { Placement, PrivateSave, PrivateTarget } from "./placement.js";
import { isUuid, lineEnding } from "./shared.js";

export const API_KEY_VARIABLE = "LEMMA_API_KEY";
export const PROJECT_ID_VARIABLE = "LEMMA_PROJECT_ID";
const SETUP_VARIABLES = [API_KEY_VARIABLE, PROJECT_ID_VARIABLE] as const;

/** `.env.example` holds placeholders only and is meant to be committed. */
const NEW_EXAMPLE_FILE_MODE = 0o644;

const ASSIGNMENT =
  /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/;

function unquoted(raw: string): string {
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2) {
    const end = raw.indexOf(quote, 1);
    if (end > 0) return raw.slice(1, end);
  }
  const comment = raw.search(/\s#/);
  return (comment === -1 ? raw : raw.slice(0, comment)).trim();
}

/** Every value assigned to each variable, in file order. */
export function parseEnvAssignments(contents: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const line of contents.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    const [, , , name, raw] = match;
    values.set(name, [...(values.get(name) ?? []), unquoted(raw)]);
  }
  return values;
}

/**
 * The one value `name` has in the file, or null when it is missing, empty,
 * or assigned conflicting values (dotenv loaders disagree on which wins).
 */
export function singleValue(
  assignments: Map<string, string[]>,
  name: string,
): string | null {
  const distinct = new Set(assignments.get(name) ?? []);
  if (distinct.size !== 1) return null;
  const [value] = distinct;
  return value ? value : null;
}

/**
 * Sets each variable in place, keeping every other line, its `export`
 * prefix, and the file's line endings; appends the variables it lacks.
 */
export function upsertEnvContents(
  contents: string,
  values: Readonly<Record<string, string>>,
): string {
  const eol = lineEnding(contents);
  const seen = new Set<string>();
  const lines = contents === "" ? [] : contents.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const updated = lines.map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;
    const [, indent, exported = "", name] = match;
    if (!(name in values)) return line;
    seen.add(name);
    return `${indent}${exported}${name}=${values[name]}`;
  });
  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) updated.push(`${name}=${value}`);
  }
  return `${updated.join(eol)}${eol}`;
}

/** Appends `NAME=` for each variable the file does not mention yet. */
export function addPlaceholders(
  contents: string,
  names: readonly string[],
): { contents: string; added: string[] } {
  const present = parseEnvAssignments(contents);
  const added = names.filter((name) => !present.has(name));
  if (added.length === 0) return { contents, added };
  return {
    contents: upsertEnvContents(
      contents,
      Object.fromEntries(added.map((name) => [name, ""])),
    ),
    added,
  };
}

/** The key `.env` already holds, read once when setup plans. */
export type ExistingIngestKey =
  | { kind: "none" }
  /** A key without a usable `LEMMA_PROJECT_ID` to check it against. */
  | { kind: "unusable" }
  | { kind: "key"; apiKey: string; projectId: string };

function existingIngestKey(contents: string | null): ExistingIngestKey {
  if (contents === null) return { kind: "none" };
  const assignments = parseEnvAssignments(contents);
  const apiKey = singleValue(assignments, API_KEY_VARIABLE);
  if (!apiKey) return { kind: "none" };
  const projectId = singleValue(assignments, PROJECT_ID_VARIABLE);
  return isUuid(projectId)
    ? { kind: "key", apiKey, projectId }
    : { kind: "unusable" };
}

/** `.env` as setup sees it: a file it may write (or create), or not. */
type EnvFile =
  | { kind: "not-editable"; why: NotEditableWhy }
  | { kind: "editable"; contents: string | null; mode: number | null };

/** The one reader of `.env`, for planning and for writing. */
async function readEnvFile(path: string): Promise<EnvFile> {
  const state = await inspectFile(path);
  switch (state.kind) {
    case "not-editable":
      return state;
    case "missing":
      return { kind: "editable", contents: null, mode: null };
    case "file":
      return { kind: "editable", contents: state.contents, mode: state.mode };
  }
}

function notWrittenReason(path: string, why: NotEditableWhy): string {
  return `${path} ${why}, so setup does not write it`;
}

/**
 * What every `.env` target carries: the key `.env` already holds, read once
 * at planning, and the private file the key goes to, which is the plan for
 * a private target and the fallback otherwise.
 */
type EnvTargetBase = { existing: ExistingIngestKey; fallbackPath: string };

type EnvFileTarget = EnvTargetBase & { kind: "env-file"; path: string };

/**
 * Where the app's ingest key goes, decided before the handshake starts.
 * `.env` is never written through a symlink or over something that is not
 * a file; then the key goes to its private file, announced up front.
 */
export type EnvTarget = EnvFileTarget | (EnvTargetBase & PrivateTarget);

/** A target setup writes the ingest key into. */
export type PlaceableEnvTarget = Exclude<EnvTarget, PrivateTarget>;

export async function planEnvTarget(
  path: string,
  fallbackPath: string,
): Promise<EnvTarget> {
  const file = await readEnvFile(path);
  return file.kind === "not-editable"
    ? {
        kind: "private",
        reason: notWrittenReason(path, file.why),
        existing: { kind: "none" },
        fallbackPath,
      }
    : {
        kind: "env-file",
        path,
        existing: existingIngestKey(file.contents),
        fallbackPath,
      };
}

/** The line announcing, before approval, that the key will go to its private file. */
export function plannedEnvNote(target: EnvTarget): string | null {
  return target.kind === "private"
    ? `.env: ${target.reason}. After approval, setup saves ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE} to ${target.fallbackPath} (readable only by you) instead.`
    : null;
}

async function gitIgnoreWarning(
  path: string,
  run: RunCommand,
): Promise<string[]> {
  return (await isGitIgnored(path, run)) === false
    ? [
        "Warning: git does not ignore .env. Add .env to .gitignore before you commit, so the key stays out of the repository.",
      ]
    : [];
}

/**
 * Writes the new ingest key and its project to `.env`, owner-only when the
 * file is new, with a warning when others can read the file or git does not
 * ignore it.
 */
export async function placeIngestKey(input: {
  target: PlaceableEnvTarget;
  projectId: string;
  apiKey: string;
  run: RunCommand;
}): Promise<Placement> {
  const { path } = input.target;
  try {
    const file = await readEnvFile(path);
    if (file.kind === "not-editable") {
      return { placed: false, reason: notWrittenReason(path, file.why) };
    }
    await writeFileAtomic(
      path,
      upsertEnvContents(file.contents ?? "", {
        [API_KEY_VARIABLE]: input.apiKey,
        [PROJECT_ID_VARIABLE]: input.projectId,
      }),
      file.mode ?? PRIVATE_FILE_MODE,
    );
    return {
      placed: true,
      lines: [
        file.contents === null
          ? `.env: created with ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE}, readable only by you.`
          : `.env: set ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE}.`,
        ...(file.mode !== null && othersCanRead(file.mode)
          ? [othersCanReadWarning(path, file.mode, "the ingest key")]
          : []),
        ...(await gitIgnoreWarning(path, input.run)),
      ],
    };
  } catch (error) {
    return {
      placed: false,
      reason: `setup could not write ${path} (${failureReason(error)})`,
    };
  }
}

/** The lines for a key the server kept: the key stays in `.env`. */
export async function keptIngestLines(
  target: EnvTarget,
  run: RunCommand,
): Promise<string[]> {
  return [
    `.env: kept ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE}; the key is already limited to this project.`,
    ...(target.kind === "env-file"
      ? await gitIgnoreWarning(target.path, run)
      : []),
  ];
}

export function missingIngestLine(projectId: string): string {
  return `.env: Lemma approved project ${projectId} but returned no ingest key for it, and .env holds no key for that project. Run \`start\` again.`;
}

/** Saves the key and its project where only the user can read them. */
export async function saveIngestKeyPrivately(input: {
  fallbackPath: string;
  projectId: string;
  apiKey: string;
  reason: string;
}): Promise<PrivateSave> {
  const { reason } = input;
  try {
    await writePrivateFile(
      input.fallbackPath,
      upsertEnvContents("", {
        [API_KEY_VARIABLE]: input.apiKey,
        [PROJECT_ID_VARIABLE]: input.projectId,
      }),
    );
  } catch (error) {
    return {
      saved: false,
      lines: [
        `.env: ${reason}, and setup could not save the key elsewhere (${failureReason(error)}). Run \`start\` again.`,
      ],
    };
  }
  return {
    saved: true,
    lines: [
      `.env: ${reason}. ${API_KEY_VARIABLE} and ${PROJECT_ID_VARIABLE} are in ${input.fallbackPath} (readable only by you); copy them where the app loads its environment, then delete that file.`,
    ],
  };
}

/**
 * What setup does with `.env.example`. A symlink or a non-file is skipped:
 * a shared example is not worth editing or failing setup over.
 */
export type EnvExamplePlan =
  | { kind: "skip"; reason: string }
  | { kind: "update"; path: string };

function exampleSkipLine(path: string, why: NotEditableWhy): string {
  return `.env.example: ${path} ${why}, so setup leaves it unchanged.`;
}

export async function planEnvExample(path: string): Promise<EnvExamplePlan> {
  const state = await inspectFile(path).catch(() => null);
  return state?.kind === "not-editable"
    ? { kind: "skip", reason: exampleSkipLine(path, state.why) }
    : { kind: "update", path };
}

/** The line announcing, before approval, that `.env.example` is skipped. */
export function plannedExampleNote(plan: EnvExamplePlan): string | null {
  return plan.kind === "skip" ? plan.reason : null;
}

/**
 * Adds empty placeholders for the setup variables to `.env.example`, and
 * returns the lines that say what it did. It never fails setup: a skip or
 * a failed write is reported and nothing else. A planned skip returns no
 * line, since `start` and `wait` print it with the plan.
 */
export async function writeEnvExample(plan: EnvExamplePlan): Promise<string[]> {
  if (plan.kind === "skip") return [];
  try {
    const state = await inspectFile(plan.path);
    if (state.kind === "not-editable") {
      return [exampleSkipLine(plan.path, state.why)];
    }
    const existing = state.kind === "file" ? state : null;
    const { contents, added } = addPlaceholders(
      existing?.contents ?? "",
      SETUP_VARIABLES,
    );
    if (added.length === 0) return [];
    await writeFileAtomic(
      plan.path,
      contents,
      existing?.mode ?? NEW_EXAMPLE_FILE_MODE,
    );
    return [
      `.env.example: ${existing ? "added" : "created with"} ${added.map((name) => `${name}=`).join(" and ")}.`,
    ];
  } catch (error) {
    return [
      `.env.example: setup could not update it (${failureReason(error)}).`,
    ];
  }
}
