import { runSetup, type SetupOptions } from "./setup.js";

function usage(): never {
  console.error(
    "Usage: lemma-pi setup [--api-url URL] [--data-dir PATH] [--no-browser]",
  );
  process.exit(2);
}

function parseOptions(args: string[]): SetupOptions {
  const remaining = args[0] === "setup" ? args.slice(1) : args;
  const options: SetupOptions = {};
  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    switch (argument) {
      case "--api-url":
        options.apiUrl = remaining[index + 1] ?? usage();
        index += 1;
        break;
      case "--data-dir":
        options.dataDir = remaining[index + 1] ?? usage();
        index += 1;
        break;
      case "--no-browser":
        options.openBrowser = false;
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
    `Lemma Pi setup failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
