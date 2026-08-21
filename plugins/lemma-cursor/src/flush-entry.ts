import { stderr } from "node:process";

import { flushPendingTurns } from "./hook-handler.js";

try {
  await flushPendingTurns({
    warn: (message) => stderr.write(`${message}\n`),
  });
} catch (error) {
  stderr.write(
    `Lemma Cursor background delivery failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
