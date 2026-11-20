/**
 * The variant both plans use for a key announced, before approval, to go to
 * its private file. `reason` is a clause: the line that prints it adds the
 * `.env:` or `MCP:` prefix and the period.
 */
export type PrivateTarget = { kind: "private"; reason: string };

export function isPrivateTarget(target: {
  kind: string;
}): target is PrivateTarget {
  return target.kind === "private";
}

/** A writer either placed the key where the plan said, or says why not (a clause, as above). */
export type Placement =
  | { placed: true; lines: string[] }
  | { placed: false; reason: string };

/** The result of saving a key to its private file, with the lines that say so. */
export type PrivateSave = { saved: boolean; lines: string[] };

/** Where one key ended up after the one-time exchange, with the lines that say so. */
export type KeyOutcome =
  /** In `.env` or the coding agent's MCP config. */
  | { kind: "written"; lines: string[] }
  /** The client's existing key stays, with what the app needs beside it. */
  | { kind: "kept"; lines: string[] }
  /** The client's existing key stays, but setup could not set or remove what the app needs beside it. */
  | { kind: "kept-incomplete"; lines: string[] }
  /**
   * In a file only the user can read, for the user to copy. `planned` when
   * setup announced that file before approval; otherwise a write failed.
   */
  | { kind: "saved-privately"; planned: boolean; lines: string[] }
  /** Nowhere: the server returned no key, or every write failed. */
  | { kind: "nothing-saved"; lines: string[] };
