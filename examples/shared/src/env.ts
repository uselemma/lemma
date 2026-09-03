import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function walkForEnv(startDir: string): string[] {
  const files: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) files.push(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

/** Load the nearest `.env` files (example folder, then `examples/.env`). */
export function loadExampleEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [...walkForEnv(process.cwd()), ...walkForEnv(here)].reverse()) {
    config({ path: file, override: false });
  }
}

export function requireOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Set OPENAI_API_KEY. Copy examples/.env.example to examples/.env.",
    );
  }
  return key;
}
