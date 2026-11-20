import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  bearerKey,
  codexToml,
  existingKeyOf,
  hermesYaml,
  mcpServersJson,
  opencodeJson,
  openclawJson,
  UnsupportedConfigError,
} from "./formats.js";

const URL_ = "https://api.uselemma.ai/mcp/";
const KEY = "lemma_sk_admin_0123456789abcdef";
const OLD = "lemma_sk_old_admin_0123456789";
const AUTH = `Bearer ${KEY}`;

describe("the existing key", () => {
  it("reads a literal bearer key, and tells an env reference or odd header apart", () => {
    expect(bearerKey(`Bearer ${OLD}`)).toBe(OLD);
    expect(bearerKey("Bearer ${LEMMA_KEY}")).toBeNull();
    expect(bearerKey("Basic abc")).toBeNull();
    expect(existingKeyOf(undefined, "headers")).toEqual({ kind: "none" });
    expect(
      existingKeyOf({ headers: { authorization: `bearer ${OLD}` } }, "headers"),
    ).toEqual({ kind: "key", key: OLD });
    expect(
      existingKeyOf(
        { headers: { Authorization: "Bearer {env:LEMMA}" } },
        "headers",
      ),
    ).toEqual({ kind: "unusable" });
    expect(existingKeyOf({ url: "https://x" }, "headers")).toEqual({
      kind: "unusable",
    });
    expect(
      existingKeyOf(
        { headers: { Authorization: `Bearer ${OLD}` } },
        "http_headers",
      ),
    ).toEqual({ kind: "unusable" });
  });
});

describe("mcpServers JSON (Cursor, Pi)", () => {
  it("adds the lemma server and keeps other servers and settings", () => {
    const parsed = mcpServersJson.parse(
      JSON.stringify({
        theme: "dark",
        mcpServers: { github: { url: "https://gh" } },
      }),
    );
    expect(parsed.existing).toEqual({ kind: "none" });
    const written = parsed.set(URL_, KEY);
    expect(written.replaced).toBe(false);
    expect(JSON.parse(written.contents)).toEqual({
      theme: "dark",
      mcpServers: {
        github: { url: "https://gh" },
        lemma: { url: URL_, headers: { Authorization: AUTH } },
      },
    });
    expect(mcpServersJson.parse(written.contents).existing).toEqual({
      kind: "key",
      key: KEY,
    });
  });

  it("starts a new file and replaces an existing lemma server", () => {
    expect(
      JSON.parse(mcpServersJson.parse(null).set(URL_, KEY).contents),
    ).toEqual({
      mcpServers: { lemma: { url: URL_, headers: { Authorization: AUTH } } },
    });
    const parsed = mcpServersJson.parse(
      JSON.stringify({
        mcpServers: {
          lemma: {
            url: "https://old",
            headers: { Authorization: `Bearer ${OLD}` },
          },
        },
      }),
    );
    expect(parsed.existing).toEqual({ kind: "key", key: OLD });
    expect(parsed.set(URL_, KEY).replaced).toBe(true);
  });

  it("refuses a config it cannot edit as JSON", () => {
    expect(() => mcpServersJson.parse("{ // comment\n}")).toThrow(
      UnsupportedConfigError,
    );
    expect(() => mcpServersJson.parse('{"mcpServers": []}')).toThrow(
      "not an object",
    );
  });
});

describe("OpenCode", () => {
  it("writes the earlier mcp.<name> shape when the config has no mcp.servers", () => {
    const written = opencodeJson
      .parse(
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: { other: { type: "local", command: ["x"] } },
        }),
      )
      .set(URL_, KEY);
    expect(JSON.parse(written.contents)).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        other: { type: "local", command: ["x"] },
        lemma: {
          type: "remote",
          url: URL_,
          headers: { Authorization: AUTH },
          oauth: false,
          enabled: true,
        },
      },
    });
    expect(opencodeJson.parse(written.contents).existing).toEqual({
      kind: "key",
      key: KEY,
    });
  });

  it("writes mcp.servers.<name> when the config uses it, reading and dropping an earlier lemma entry", () => {
    const parsed = opencodeJson.parse(
      JSON.stringify({
        mcp: {
          servers: { other: { type: "remote", url: "https://x" } },
          lemma: {
            type: "remote",
            url: "https://old",
            headers: { Authorization: `Bearer ${OLD}` },
          },
        },
      }),
    );
    expect(parsed.existing).toEqual({ kind: "key", key: OLD });
    const written = parsed.set(URL_, KEY);
    expect(written.replaced).toBe(true);
    expect(JSON.parse(written.contents)).toEqual({
      mcp: {
        servers: {
          other: { type: "remote", url: "https://x" },
          lemma: {
            type: "remote",
            url: URL_,
            headers: { Authorization: AUTH },
            oauth: false,
          },
        },
      },
    });
  });

  it("refuses JSONC with comments", () => {
    expect(() => opencodeJson.parse('{\n  // models\n  "mcp": {}\n}')).toThrow(
      "is not plain JSON",
    );
  });
});

describe("OpenClaw", () => {
  it("writes mcp.servers.lemma with the streamable-http transport", () => {
    const written = openclawJson
      .parse(
        JSON.stringify({
          gateway: { port: 18789 },
          mcp: {
            servers: {
              docs: { url: "https://d", transport: "streamable-http" },
            },
          },
        }),
      )
      .set(URL_, KEY);
    expect(JSON.parse(written.contents)).toEqual({
      gateway: { port: 18789 },
      mcp: {
        servers: {
          docs: { url: "https://d", transport: "streamable-http" },
          lemma: {
            url: URL_,
            transport: "streamable-http",
            headers: { Authorization: AUTH },
          },
        },
      },
    });
  });

  it("refuses JSON5 syntax", () => {
    expect(() => openclawJson.parse("{ gateway: { port: 1, }, }")).toThrow(
      UnsupportedConfigError,
    );
  });
});

describe("Codex config.toml", () => {
  const existing = [
    "# Codex settings",
    'model = "gpt-5"',
    "",
    "[mcp_servers.github]",
    'url = "https://gh"',
    "",
    "[mcp_servers.lemma]",
    'url = "https://old/mcp/"',
    `http_headers = { Authorization = "Bearer ${OLD}" }`,
    "",
    "[mcp_servers.lemma.tools.list_issues]",
    'approval_mode = "auto"',
    "",
    "[profiles.fast]",
    'model = "gpt-5-mini"',
    "",
  ].join("\n");

  it("reads the key from http_headers, replaces the lemma table, and keeps every other line and comment", () => {
    const parsed = codexToml.parse(existing);
    expect(parsed.existing).toEqual({ kind: "key", key: OLD });
    const written = parsed.set(URL_, KEY);
    expect(written.replaced).toBe(true);
    expect(written.contents).toBe(
      [
        "# Codex settings",
        'model = "gpt-5"',
        "",
        "[mcp_servers.github]",
        'url = "https://gh"',
        "",
        "[profiles.fast]",
        'model = "gpt-5-mini"',
        "",
        "[mcp_servers.lemma]",
        `url = "${URL_}"`,
        `http_headers = { Authorization = "${AUTH}" }`,
        "",
      ].join("\n"),
    );
    expect(parseToml(written.contents)).toMatchObject({
      mcp_servers: {
        lemma: { url: URL_, http_headers: { Authorization: AUTH } },
      },
    });
  });

  it("keeps a comment block above the table that follows the lemma table", () => {
    const source = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.lemma]",
      "# the old key, rotate me",
      `http_headers = { Authorization = "Bearer ${OLD}" }`,
      'url = "https://old/mcp/"',
      "",
      "# Profiles for quick runs.",
      "# Keep these in sync with CI.",
      "[profiles.fast]",
      'model = "gpt-5-mini"',
      "",
    ].join("\n");
    expect(codexToml.parse(source).set(URL_, KEY).contents).toBe(
      [
        'model = "gpt-5"',
        "",
        "# Profiles for quick runs.",
        "# Keep these in sync with CI.",
        "[profiles.fast]",
        'model = "gpt-5-mini"',
        "",
        "[mcp_servers.lemma]",
        `url = "${URL_}"`,
        `http_headers = { Authorization = "${AUTH}" }`,
        "",
      ].join("\n"),
    );
  });

  it("keeps comments that trail the lemma table at the end of the file", () => {
    const source = [
      "[mcp_servers.lemma]",
      'url = "https://old/mcp/"',
      "",
      "# end of config",
      "",
    ].join("\n");
    expect(codexToml.parse(source).set(URL_, KEY).contents).toBe(
      [
        "# end of config",
        "",
        "[mcp_servers.lemma]",
        `url = "${URL_}"`,
        `http_headers = { Authorization = "${AUTH}" }`,
        "",
      ].join("\n"),
    );
  });

  it("creates the table in a new config", () => {
    expect(codexToml.parse(null).set(URL_, KEY)).toEqual({
      contents: `[mcp_servers.lemma]\nurl = "${URL_}"\nhttp_headers = { Authorization = "${AUTH}" }\n`,
      replaced: false,
    });
  });

  it("refuses, when reading, invalid TOML and a config whose lemma server or mcp_servers setup cannot edit", () => {
    expect(() => codexToml.parse("model = ")).toThrow("is not valid TOML");
    for (const source of [
      '[mcp_servers]\nlemma = { url = "https://old" }\n',
      'mcp_servers.lemma.url = "https://old"\n',
      "mcp_servers = 1\n",
    ]) {
      expect(() => codexToml.parse(source)).toThrow(UnsupportedConfigError);
      expect(() => codexToml.parse(source)).toThrow(
        "in a form setup cannot edit",
      );
    }
  });

  it("renders with set once parse accepts the file", () => {
    const parsed = codexToml.parse(
      '[mcp_servers.github]\nurl = "https://gh"\n',
    );
    expect(() => parsed.set(URL_, KEY)).not.toThrow();
    expect(parseToml(parsed.set(URL_, KEY).contents)).toEqual({
      mcp_servers: {
        github: { url: "https://gh" },
        lemma: { url: URL_, http_headers: { Authorization: AUTH } },
      },
    });
  });
});

describe("Hermes config.yaml", () => {
  it("sets mcp_servers.lemma and keeps comments and other servers", () => {
    const parsed = hermesYaml.parse(
      "# Hermes\nmodel: hermes-4\nmcp_servers:\n  # docs search\n  docs:\n    url: https://d\n",
    );
    expect(parsed.existing).toEqual({ kind: "none" });
    const written = parsed.set(URL_, KEY);
    expect(written.replaced).toBe(false);
    expect(written.contents).toContain("# Hermes");
    expect(written.contents).toContain("# docs search");
    expect(parseYaml(written.contents)).toEqual({
      model: "hermes-4",
      mcp_servers: {
        docs: { url: "https://d" },
        lemma: { url: URL_, headers: { Authorization: AUTH } },
      },
    });
    expect(hermesYaml.parse(written.contents).existing).toEqual({
      kind: "key",
      key: KEY,
    });
  });

  it("creates mcp_servers in a new or empty config and replaces an existing lemma server", () => {
    const entry = {
      mcp_servers: { lemma: { url: URL_, headers: { Authorization: AUTH } } },
    };
    expect(parseYaml(hermesYaml.parse(null).set(URL_, KEY).contents)).toEqual(
      entry,
    );
    expect(
      parseYaml(hermesYaml.parse("mcp_servers:\n").set(URL_, KEY).contents),
    ).toEqual(entry);
    expect(
      hermesYaml
        .parse("mcp_servers:\n  lemma:\n    url: https://old\n")
        .set(URL_, KEY).replaced,
    ).toBe(true);
  });

  it("refuses invalid YAML, a non-mapping mcp_servers, and a non-mapping document", () => {
    expect(() => hermesYaml.parse("a: [")).toThrow("is not valid YAML");
    expect(() => hermesYaml.parse("mcp_servers: [docs]\n")).toThrow(
      "not a mapping",
    );
    expect(() => hermesYaml.parse("- a\n- b\n")).toThrow("not a YAML mapping");
  });
});
