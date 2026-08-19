import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { stderr } from "node:process";
import { fileURLToPath } from "node:url";

import { handleCodexHook, type CodexHookInput } from "./hook-handler.js";
import { readNotifyForwarder, resolveDataDir } from "./storage.js";

function spawnDetached(command: string, args: string[], label: string): void {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.once("error", (error) => {
      stderr.write(`Lemma Codex could not start ${label}: ${error.message}\n`);
    });
    child.unref();
  } catch (error) {
    stderr.write(
      `Lemma Codex could not start ${label}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

function scheduleTraceDelivery(): void {
  const flushEntry = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "flush.mjs",
  );
  spawnDetached(process.execPath, [flushEntry], "trace delivery");
}

async function main(): Promise<void> {
  const raw = process.argv.at(-1);
  if (!raw || raw === fileURLToPath(import.meta.url)) return;

  const input = JSON.parse(raw) as CodexHookInput;
  const dataDir = resolveDataDir();
  const forwarder = await readNotifyForwarder(dataDir);
  if (forwarder?.command?.length) {
    const [command, ...args] = forwarder.command;
    spawnDetached(command, [...args, raw], "the existing Codex notifier");
  }

  const result = await handleCodexHook(input, {
    dataDir,
    warn: (message) => stderr.write(`${message}\n`),
  });
  if (result.status === "queued") scheduleTraceDelivery();
}

try {
  delete process.env.LEMMA_DEBUG;
  delete process.env.LEMMA_DEBUG_VERIFY;
  await main();
} catch (error) {
  stderr.write(
    `Lemma Codex completion notification failed open: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
