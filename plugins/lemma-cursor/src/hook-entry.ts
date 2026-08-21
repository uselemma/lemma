import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { handleCursorHook, type CursorHookInput } from "./hook-handler.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function scheduleTraceDelivery(): void {
  const flushEntry = resolve(dirname(fileURLToPath(import.meta.url)), "flush.mjs");
  const child = spawn(process.execPath, [flushEntry], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

function hookOutput(input: CursorHookInput): Record<string, unknown> {
  switch (input.hook_event_name) {
    case "beforeSubmitPrompt":
    case "UserPromptSubmit":
      return { continue: true };
    case "preToolUse":
    case "PreToolUse":
      return { permission: "allow" };
    default:
      return {};
  }
}

async function main(): Promise<void> {
  let input: CursorHookInput = {};
  try {
    delete process.env.LEMMA_DEBUG;
    delete process.env.LEMMA_DEBUG_VERIFY;
    input = JSON.parse(await readStdin()) as CursorHookInput;
    const result = await handleCursorHook(input, {
      warn: (message) => stderr.write(`${message}\n`),
    });
    if (
      result.status === "queued" ||
      (result.status === "recorded" && result.event === "beforeSubmitPrompt")
    ) {
      scheduleTraceDelivery();
    }
  } catch (error) {
    stderr.write(
      `Lemma Cursor hook failed open: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  stdout.write(`${JSON.stringify(hookOutput(input))}\n`);
}

await main();
