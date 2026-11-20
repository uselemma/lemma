/** A `[mcp_servers.lemma]` table header, or one of its sub-tables. */
const LEMMA_TABLE_HEADER =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:lemma|"lemma"|'lemma')\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
const TABLE_HEADER = /^\s*\[/;
const COMMENT_OR_BLANK = /^\s*(?:#.*)?$/;

function isBlank(line: string | undefined): boolean {
  return line !== undefined && line.trim() === "";
}

/**
 * The lines of a Codex `config.toml` without the `lemma` table and its
 * sub-tables, trailing blank lines dropped. Comment and blank lines inside a
 * skipped table are held back: a key line shows they belonged to the table,
 * and the next header shows they belong to what follows, so they are
 * written back above it.
 */
export function withoutLemmaTable(source: string): string[] {
  const kept: string[] = [];
  let held: string[] = [];
  let skipping = false;
  const keepHeld = () => {
    while (
      isBlank(held[0]) &&
      (kept.length === 0 || isBlank(kept[kept.length - 1]))
    ) {
      held.shift();
    }
    kept.push(...held);
    held = [];
  };
  for (const line of source === "" ? [] : source.split(/\r?\n/)) {
    if (LEMMA_TABLE_HEADER.test(line)) {
      skipping = true;
      held = [];
      continue;
    }
    if (!skipping) {
      kept.push(line);
    } else if (TABLE_HEADER.test(line)) {
      keepHeld();
      skipping = false;
      kept.push(line);
    } else if (COMMENT_OR_BLANK.test(line)) {
      held.push(line);
    } else {
      held = [];
    }
  }
  if (skipping) keepHeld();
  while (isBlank(kept[kept.length - 1])) kept.pop();
  return kept;
}
