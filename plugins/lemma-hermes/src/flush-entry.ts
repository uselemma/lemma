import { stderr } from "node:process";

import { flushPendingTurns } from "./flush.js";

try {
  await flushPendingTurns({
    warn: (message) => stderr.write(`${message}\n`),
  });
} catch (error) {
  stderr.write(
    `Lemma Hermes background delivery failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
