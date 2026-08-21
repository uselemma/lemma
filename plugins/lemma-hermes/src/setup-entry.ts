import { runSetup, type SetupOptions } from "./setup.js";

function usage(): never {
  console.error(
    "Usage: lemma-hermes setup [--api-url URL] [--data-dir PATH] [--no-browser] [--skip-install]",
  );
  process.exit(2);
}

function parseOptions(args: string[]): SetupOptions {
  const options: SetupOptions = {};
  const values = args[0] === "setup" ? args.slice(1) : args;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    switch (argument) {
      case "--api-url":
        options.apiUrl = values[index + 1] ?? usage();
        index += 1;
        break;
      case "--data-dir":
        options.dataDir = values[index + 1] ?? usage();
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
    `Lemma Hermes setup failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
