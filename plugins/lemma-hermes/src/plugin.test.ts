import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const directories: string[] = [];
const pluginRoot = resolve("hermes-plugin/lemma");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Hermes native plugin", () => {
  it(
    "buffers lifecycle events and writes one sanitized pending turn",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "lemma-hermes-plugin-"));
      directories.push(dataDir);
      await writeFile(
        join(dataDir, "credentials.json"),
        JSON.stringify({
          version: 1,
          apiUrl: "https://dev.api.uselemma.ai",
          projectId: "project-1",
          credentialId: "credential-1",
          accessToken: "secret-token",
        }),
      );
      const script = String.raw`
import importlib.util, json, pathlib, sys
plugin_path = pathlib.Path(sys.argv[1]) / "__init__.py"
spec = importlib.util.spec_from_file_location("lemma_plugin", plugin_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._spawn_flush = lambda: None
module.on_pre_llm_call(session_id="session-1", turn_id="turn-1", user_message="Fix it", model="model-1", platform="cli")
module.on_pre_api_request(session_id="session-1", turn_id="turn-1", provider="provider-1", model="model-1")
module.on_pre_tool_call(session_id="session-1", turn_id="turn-1", tool_call_id="tool-1", tool_name="terminal", args={"command": "echo ok", "api_key": "do-not-store"})
module.on_post_tool_call(session_id="session-1", turn_id="turn-1", tool_call_id="tool-1", tool_name="terminal", result={"output": "ok", "access_token": "do-not-store"}, status="ok")
module.on_post_api_request(session_id="session-1", turn_id="turn-1", assistant_message={"content": "Done"}, provider="provider-1", response_model="model-1")
module.on_session_end(session_id="session-1", turn_id="turn-1", completed=True, model="model-1", platform="cli", turn_exit_reason="text_response(stop)")
`;
      await run("python3", ["-c", script, pluginRoot], {
        env: { ...process.env, LEMMA_HERMES_DATA_DIR: dataDir },
      });
      const pendingFiles = await readdir(join(dataDir, "pending"));
      expect(pendingFiles).toHaveLength(1);
      const pending = await readFile(
        join(dataDir, "pending", pendingFiles[0]),
        "utf8",
      );
      expect(pending).not.toContain("do-not-store");
      expect(JSON.parse(pending)).toMatchObject({
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        turn: {
          sessionId: "session-1",
          turnId: "turn-1",
          prompt: "Fix it",
          response: "Done",
          tools: [{ toolUseId: "tool-1", toolName: "terminal" }],
        },
      });
    },
    15_000,
  );

  it("ships no MCP, skill, or OTLP configuration", async () => {
    const contents = await Promise.all(
      ["__init__.py", "plugin.yaml"].map((name) =>
        readFile(resolve(pluginRoot, name), "utf8"),
      ),
    );
    expect(contents.join("\n")).not.toContain("mcp_servers");
    expect(contents.join("\n")).not.toContain("register_skill");
    expect(contents.join("\n")).not.toContain("/otel/v1/traces");
  });

  it("discovers the setup data directory from Hermes home", async () => {
    const hermesHome = await mkdtemp(join(tmpdir(), "lemma-hermes-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "lemma-hermes-custom-"));
    directories.push(hermesHome, dataDir);
    await writeFile(
      join(dataDir, "credentials.json"),
      JSON.stringify({
        version: 1,
        apiUrl: "https://dev.api.uselemma.ai",
        projectId: "project-1",
        credentialId: "credential-1",
        accessToken: "secret-token",
      }),
    );
    await mkdir(join(hermesHome, "lemma"), { recursive: true });
    await writeFile(
      join(hermesHome, "lemma", "data-dir-location.json"),
      JSON.stringify({ version: 1, dataDir }),
    );
    const script = String.raw`
import importlib.util, pathlib, sys
plugin_path = pathlib.Path(sys.argv[1]) / "__init__.py"
spec = importlib.util.spec_from_file_location("lemma_plugin", plugin_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._spawn_flush = lambda: None
module.on_pre_llm_call(session_id="session-1", turn_id="turn-1", user_message="Fix it")
module.on_session_end(session_id="session-1", turn_id="turn-1", completed=True)
print(module._data_dir())
`;
    const result = await run("python3", ["-c", script, pluginRoot], {
      env: { ...process.env, HERMES_HOME: hermesHome, LEMMA_HERMES_DATA_DIR: "" },
    });

    expect(await realpath(result.stdout.trim())).toBe(await realpath(dataDir));
    expect(await readdir(join(dataDir, "pending"))).toHaveLength(1);
  });
});
