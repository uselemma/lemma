import { runSetup, type SetupOptions } from "./setup.js";

function usage(): never {
  console.error(
    "Usage: node scripts/setup.mjs [--api-url URL] [--data-dir PATH] [--no-browser] [--skip-install]",
  );
  process.exit(2);
}

function parseOptions(args: string[]): SetupOptions {
  const options: SetupOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--api-url":
        options.apiUrl = args[index + 1] ?? usage();
        index += 1;
        break;
      case "--data-dir":
        options.dataDir = args[index + 1] ?? usage();
        index += 1;
        break;
      case "--no-browser":
        options.openBrowser = false;
        break;
      case "--skip-install":
        options.installPlugin = false;
        break;
      default:
        usage();
    }
  }
  return options;
}

try {
  await runSetup(parseOptions(process.argv.slice(2)));
} catch (error) {
  console.error(
    `Lemma Claude Code setup failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
