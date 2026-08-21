import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Pi package layout", () => {
  it("declares an installable extension package with Pi peers", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(pluginRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "@uselemma/pi",
      pi: { extensions: ["./extensions"] },
      peerDependencies: {
        "@earendil-works/pi-coding-agent": "^0.84.2",
        "@earendil-works/pi-telemetry": "^0.84.2",
      },
    });
    expect(manifest).not.toHaveProperty("private", true);
  });

  it("ships no MCP, skill, investigation, or OTLP configuration", async () => {
    for (const path of ["mcp.json", "skills", ".mcp.json", "otel.json"]) {
      await expect(access(resolve(pluginRoot, path))).rejects.toThrow();
    }
    const manifest = await readFile(
      resolve(pluginRoot, "package.json"),
      "utf8",
    );
    expect(manifest).not.toContain("mcpServers");
    expect(manifest).not.toContain('"skills"');
    const sources = await readdir(resolve(pluginRoot, "src"));
    const contents = await Promise.all(
      sources
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => readFile(resolve(pluginRoot, "src", name), "utf8")),
    );
    expect(contents.join("\n")).not.toContain("/otel/v1/traces");
    expect(contents.join("\n")).not.toContain("diagnostics-otel");
    expect(contents.join("\n")).not.toContain("investigation CLI");
  });
});
