import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { handleCodexHook, type CodexHookInput } from "./hook-handler.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function scheduleTraceDelivery(): void {
  const flushEntry = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "flush.mjs",
  );
  const child = spawn(process.execPath, [flushEntry], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

async function main(): Promise<void> {
  try {
    // Hook stdout is a Codex protocol channel. SDK debug logging would corrupt
    // the JSON response, so diagnostics stay on stderr for hook processes.
    delete process.env.LEMMA_DEBUG;
    delete process.env.LEMMA_DEBUG_VERIFY;
    const raw = await readStdin();
    const input = JSON.parse(raw) as CodexHookInput;
    const result = await handleCodexHook(input, {
      warn: (message) => stderr.write(`${message}\n`),
    });
    if (
      result.status === "queued" ||
      (result.status === "recorded" && result.event === "UserPromptSubmit")
    ) {
      scheduleTraceDelivery();
    }
  } catch (error) {
    stderr.write(
      `Lemma Codex hook failed open: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  stdout.write("{}\n");
}

await main();
