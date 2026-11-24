/**
 * A writer either placed what the plan said where it said, or says why not:
 * `reason` is a clause the line that prints it ends with a period.
 */
export type Placement =
  | { placed: true; lines: string[] }
  | { placed: false; reason: string };
