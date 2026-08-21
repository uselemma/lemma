import { flushPendingTurns } from "./flush.js";

try {
  await flushPendingTurns({
    warn: (message) => console.warn(message),
  });
} catch {
  console.warn(
    "Lemma OpenClaw could not flush pending traces. They will be retried after the next agent run.",
  );
}
