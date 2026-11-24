import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * The files setup keeps for itself under `~/.lemma/setup/`. Each is keyed by
 * the app's directory, so setup in a second app never overwrites a key the
 * user has not copied yet.
 */
export function setupPaths(homeDir: string, appDir: string) {
  const root = join(homeDir, ".lemma", "setup");
  const app = createHash("sha256").update(appDir).digest("hex").slice(0, 16);
  return {
    /** The started handshake `wait` polls. */
    pending: join(root, "pending", `${app}.json`),
    /** The app's ingest key when its `.env` cannot take it. */
    savedKeys: join(root, `${app}.env`),
  };
}

export type SetupPaths = ReturnType<typeof setupPaths>;
