import { describe, expect, it } from "vitest";

import { runInteractive } from "./command.js";
import { posix } from "./testing/temp.js";

// Only `/bin/sh` and a binary that does not exist are spawned here.
describe.skipIf(!posix)("running a command at the terminal", () => {
  it("reports an exit code, a command that cannot start, and a signal", async () => {
    const cwd = process.cwd();
    await expect(
      runInteractive("/bin/sh", ["-c", "exit 3"], cwd),
    ).resolves.toEqual({ kind: "exited", code: 3 });
    await expect(
      runInteractive("lemma-setup-no-such-command", [], cwd),
    ).resolves.toEqual({ kind: "not-started" });
    await expect(
      runInteractive("/bin/sh", ["-c", "kill -INT $$"], cwd),
    ).resolves.toEqual({ kind: "signaled", signal: "SIGINT" });
  });

  it("ignores Ctrl-C only while the command runs", async () => {
    const before = process.listenerCount("SIGINT");
    const running = runInteractive(
      "/bin/sh",
      ["-c", "sleep 0.2"],
      process.cwd(),
    );
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    await expect(running).resolves.toEqual({ kind: "exited", code: 0 });
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
