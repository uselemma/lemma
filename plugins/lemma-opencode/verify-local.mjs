import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OPENCODE_VERSION = "1.18.19";
const PROJECT_ID = "10000000-0000-0000-0000-000000000001";
const ACCESS_TOKEN = "lemma_ci_opencode-local-e2e";
const PROMPT = "Use the bash tool to run `printf lemma-opencode-e2e`, then report completion.";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out\n${stderr}`));
    }, options.timeoutMilliseconds ?? 120_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with ${code ?? signal ?? "unknown"}\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

function eventStream(chunks) {
  return `${chunks.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}`).join("\n\n")}\n\n`;
}

function chatChunk(delta, finishReason) {
  return {
    id: "chatcmpl-lemma-opencode-e2e",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta,
        ...(finishReason ? { finish_reason: finishReason } : {}),
      },
    ],
  };
}

function textResponse(text) {
  return eventStream([
    chatChunk({ role: "assistant" }),
    chatChunk({ content: text }),
    chatChunk({}, "stop"),
    "[DONE]",
  ]);
}

function toolResponse() {
  return eventStream([
    chatChunk({ role: "assistant" }),
    chatChunk({
      tool_calls: [
        {
          index: 0,
          id: "call_lemma_opencode_e2e",
          type: "function",
          function: { name: "bash", arguments: "" },
        },
      ],
    }),
    chatChunk({
      tool_calls: [
        {
          index: 0,
          function: {
            arguments: JSON.stringify({ command: "printf lemma-opencode-e2e" }),
          },
        },
      ],
    }),
    chatChunk({}, "tool_calls"),
    "[DONE]",
  ]);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function waitFor(predicate, message, timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(message);
}

const root = await mkdtemp(join(tmpdir(), "lemma-opencode-local-e2e-"));
let ingestRequest;
let nonTitleModelRequests = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await requestBody(request);
    if (url.pathname === "/coding-harness/device-authorizations") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          device_code: "device-opencode-local-e2e",
          user_code: "LOCAL-E2E",
          verification_uri_complete: "http://127.0.0.1/authorize/local-e2e",
          expires_in: 600,
          interval: 0,
        }),
      );
      return;
    }
    if (url.pathname === "/coding-harness/device-authorizations/token") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "approved",
          access_token: ACCESS_TOKEN,
          credential_id: "credential-opencode-local-e2e",
          project_id: PROJECT_ID,
        }),
      );
      return;
    }
    if (url.pathname === "/v1/chat/completions") {
      const titleRequest = JSON.stringify(body).includes(
        "Generate a title for this conversation",
      );
      const payload = titleRequest
        ? textResponse("OpenCode E2E")
        : ++nonTitleModelRequests === 1
          ? toolResponse()
          : textResponse("OpenCode E2E complete.");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(payload);
      return;
    }
    if (url.pathname === "/traces/ingest") {
      ingestRequest = {
        authorization: request.headers.authorization,
        body,
      };
      response.writeHead(201, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(404);
    response.end("not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

try {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Fake server did not bind");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const packDir = join(root, "pack");
  const consumerDir = join(root, "consumer");
  const configDir = join(root, "config");
  const dataDir = join(root, "lemma-data");
  const workspaceDir = join(root, "workspace");
  await Promise.all(
    [packDir, consumerDir, configDir, dataDir, workspaceDir].map((path) =>
      writeFile(join(path, ".keep"), "", { flag: "a" }).catch(async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path, { recursive: true });
        await writeFile(join(path, ".keep"), "");
      }),
    ),
  );
  const pluginRoot = dirname(fileURLToPath(import.meta.url));
  const tracingRoot = join(pluginRoot, "..", "..", "packages", "ts", "tracing");
  await run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: tracingRoot,
  });
  await run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: pluginRoot,
  });
  const archives = (await readdir(packDir)).filter((name) => name.endsWith(".tgz"));
  const tracingArchive = archives.find((name) => name.includes("tracing"));
  const archiveName = archives.find((name) => name.includes("opencode"));
  assert(tracingArchive, "Tracing package tarball was not created");
  assert(archiveName, "OpenCode package tarball was not created");
  const tracingArchivePath = join(packDir, tracingArchive);
  const archivePath = join(packDir, archiveName);
  // pnpm pack rewrites workspace:^ to ^<current version>. That version is
  // not on npm until this PR merges, so point the packed plugin at the
  // local tracing tarball before the consumer install.
  const rewriteDir = join(root, "rewrite");
  await mkdir(rewriteDir, { recursive: true });
  await run("tar", ["-xzf", archivePath, "-C", rewriteDir]);
  const packedManifestPath = join(rewriteDir, "package", "package.json");
  const packedManifest = JSON.parse(await readFile(packedManifestPath, "utf8"));
  if (packedManifest.dependencies?.["@uselemma/tracing"]) {
    packedManifest.dependencies["@uselemma/tracing"] = `file:${tracingArchivePath}`;
  }
  await writeFile(
    packedManifestPath,
    `${JSON.stringify(packedManifest, null, 2)}\n`,
  );
  await run("tar", ["-czf", archivePath, "-C", rewriteDir, "package"]);
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        pnpm: {
          overrides: {
            "@uselemma/tracing": `file:${tracingArchivePath}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await run(
    "pnpm",
    [
      "add",
      "--allow-build=opencode-ai",
      "--allow-build=msgpackr-extract",
      archivePath,
      `opencode-ai@${OPENCODE_VERSION}`,
      "typescript@5.9.3",
    ],
    { cwd: consumerDir },
  );
  await writeFile(
    join(consumerDir, "import-check.ts"),
    'import { LemmaPlugin } from "@uselemma/opencode";\n\nvoid LemmaPlugin;\n',
  );
  await writeFile(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ["import-check.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await run("pnpm", ["exec", "tsc", "--noEmit"], { cwd: consumerDir });

  const setupPath = join(consumerDir, "node_modules", ".bin", "lemma-opencode");
  const opencodePath = join(consumerDir, "node_modules", ".bin", "opencode");
  await run(
    setupPath,
    [
      "setup",
      "--api-url",
      apiUrl,
      "--config-dir",
      configDir,
      "--data-dir",
      dataDir,
      "--no-browser",
    ],
    { cwd: workspaceDir },
  );
  await access(join(configDir, "plugins", "uselemma-opencode.js"));

  await writeFile(
    join(configDir, "opencode.json"),
    `${JSON.stringify(
      {
        formatter: false,
        lsp: false,
        provider: {
          test: {
            name: "Test",
            id: "test",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            models: {
              "test-model": {
                id: "test-model",
                name: "Test Model",
                attachment: false,
                reasoning: false,
                temperature: false,
                tool_call: true,
                release_date: "2026-08-21",
                limit: { context: 100_000, output: 10_000 },
                cost: { input: 0, output: 0 },
                options: {},
              },
            },
            options: { apiKey: "test-key", baseURL: `${apiUrl}/v1` },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  const isolatedHome = join(root, "home");
  const environment = {
    ...process.env,
    HOME: isolatedHome,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    LEMMA_OPENCODE_DATA_DIR: dataDir,
    XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_STATE_HOME: join(root, "xdg-state"),
  };
  const debugInfo = await run(opencodePath, ["debug", "info"], {
    cwd: workspaceDir,
    env: environment,
  });
  assert(
    debugInfo.stdout.includes("uselemma-opencode.js"),
    `OpenCode did not discover the installed Lemma plugin:\n${debugInfo.stdout}\n${debugInfo.stderr}`,
  );
  const result = await run(
    opencodePath,
    [
      "run",
      "--print-logs",
      "--log-level",
      "DEBUG",
      "--model",
      "test/test-model",
      "--format",
      "json",
      "--auto",
      "--dir",
      workspaceDir,
      ...PROMPT.split(" "),
    ],
    { cwd: workspaceDir, env: environment, timeoutMilliseconds: 180_000 },
  );
  assert(
    result.stdout.includes("OpenCode E2E complete."),
    `OpenCode did not complete the fake model turn:\n${result.stdout}\n${result.stderr}`,
  );
  assert(
    result.stdout.includes("lemma-opencode-e2e"),
    `OpenCode did not execute the bash tool:\n${result.stdout}\n${result.stderr}`,
  );
  await waitFor(
    () => Boolean(ingestRequest),
    `Lemma ingest was not called. Pending files: ${JSON.stringify(
      await readdir(join(dataDir, "pending")).catch(() => []),
    )}\nOpenCode debug info:\n${debugInfo.stdout}\n${debugInfo.stderr}\nOpenCode stdout:\n${result.stdout}\nOpenCode stderr:\n${result.stderr}`,
  );
  assert(nonTitleModelRequests === 2, "OpenCode did not perform the tool follow-up turn");
  assert(
    ingestRequest.authorization === `Bearer ${ACCESS_TOKEN}`,
    "Lemma ingest did not use the scoped credential",
  );
  assert(ingestRequest.body.project_id === PROJECT_ID, "Lemma project ID was not preserved");
  const trace = ingestRequest.body.trace;
  assert(
    trace?.input === PROMPT,
    `Trace prompt did not match the OpenCode user turn. Expected ${JSON.stringify(PROMPT)}, received ${JSON.stringify(trace?.input)}`,
  );
  assert(trace?.output === "OpenCode E2E complete.", "Trace response did not match the final answer");
  assert(trace?.metadata?.["lemma.harness.id"] === "opencode", "Trace harness metadata is missing");
  assert(typeof trace?.thread_id === "string" && trace.thread_id.length > 0, "Trace thread ID is missing");
  const tool = trace?.spans?.find((span) => span.type === "tool" && span.tool_name === "bash");
  assert(tool?.input?.command === "printf lemma-opencode-e2e", "Trace tool input is missing");
  assert(
    JSON.stringify(tool?.output).includes("lemma-opencode-e2e"),
    "Trace tool output is missing",
  );
  const generation = trace?.spans?.find((span) => span.type === "generation");
  assert(generation?.model === "test-model", "Trace generation model is missing");
  await waitFor(async () => {
    const entries = await readdir(join(dataDir, "pending")).catch(() => []);
    return entries.length === 0;
  }, "Delivered trace remained in the pending queue");

  console.log(`Verified @uselemma/opencode with opencode-ai@${OPENCODE_VERSION}.`);
  console.log("Confirmed setup, plugin loading, native bash capture, and Lemma delivery.");
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(root, { recursive: true, force: true });
}
