import packageJson from "../package.json" with { type: "json" };

import { parseCommand, USAGE } from "./args.js";
import { defaultEnvironment } from "./context.js";
import {
  EXIT_CODES,
  failureReason,
  SetupError,
  type ExitCode,
} from "./errors.js";
import { runStart } from "./start.js";
import { runWait } from "./wait.js";

async function main(argv: string[]): Promise<ExitCode> {
  try {
    const command = parseCommand(argv);
    switch (command.kind) {
      case "help":
        console.log(USAGE);
        return EXIT_CODES.success;
      case "version":
        console.log(packageJson.version);
        return EXIT_CODES.success;
      case "start":
        await runStart(command.options, defaultEnvironment());
        return EXIT_CODES.success;
      case "wait": {
        const result = await runWait(command.options, defaultEnvironment());
        return result.status === "pending"
          ? EXIT_CODES.pending
          : EXIT_CODES.success;
      }
    }
  } catch (error) {
    console.error(`Lemma setup failed: ${failureReason(error)}`);
    return error instanceof SetupError ? error.exitCode : EXIT_CODES.failure;
  }
}

process.exitCode = await main(process.argv.slice(2));
