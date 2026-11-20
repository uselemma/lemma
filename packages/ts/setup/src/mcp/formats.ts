import { parse as parseToml } from "smol-toml";
import { isMap, isScalar, parseDocument } from "yaml";

import { API_KEY_PATTERN, isRecord, lineEnding } from "../shared.js";
import { withoutLemmaTable } from "./toml-lines.js";

/** The server name every coding agent's MCP config uses for Lemma. */
export const MCP_SERVER_NAME = "lemma";

/**
 * Thrown by `parse` for contents setup cannot edit without changing or
 * losing what is already there. The message is a clause that reads after
 * the file's path, for example "is not valid TOML".
 */
export class UnsupportedConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedConfigError";
  }
}

/** The key a coding agent's `lemma` server already sends, read at the format boundary. */
export type ExistingMcpKey =
  | { kind: "none" }
  /** A `lemma` server whose key is not a literal one, such as an env reference. */
  | { kind: "unusable" }
  | { kind: "key"; key: string };

export const NO_EXISTING_KEY: ExistingMcpKey = { kind: "none" };

/** A header's value, matching its name without case, as HTTP does. */
function headerValue(headers: unknown, name: string): unknown {
  if (!isRecord(headers)) return undefined;
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined ? undefined : headers[key];
}

/** The literal key in a `Bearer <key>` header; null for anything else. */
export function bearerKey(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && API_KEY_PATTERN.test(match[1]) ? match[1] : null;
}

/** The existing key of a `lemma` server entry whose headers live under `headersField`. */
export function existingKeyOf(
  entry: unknown,
  headersField: string,
): ExistingMcpKey {
  if (entry === undefined || entry === null) return NO_EXISTING_KEY;
  const headers = isRecord(entry) ? entry[headersField] : undefined;
  const key = bearerKey(headerValue(headers, "Authorization"));
  return key ? { kind: "key", key } : { kind: "unusable" };
}

/**
 * One parsed MCP config: what it holds for Lemma, and the file with the
 * `lemma` server set. Every check that depends on the file's contents runs
 * in `parse`, so `set` only renders.
 */
export type ParsedMcpConfig = {
  existing: ExistingMcpKey;
  set(url: string, apiKey: string): { contents: string; replaced: boolean };
};

export type McpConfigFormat = {
  /** The extension a file in this format takes, for setup's private copy. */
  fileExtension: "json" | "toml" | "yaml";
  /** `null` for a file that does not exist. Throws `UnsupportedConfigError`. */
  parse(contents: string | null): ParsedMcpConfig;
};

type JsonObject = Record<string, unknown>;
type JsonPath = readonly string[];

export function headersOf(apiKey: string): JsonObject {
  return { Authorization: `Bearer ${apiKey}` };
}

/** Key-sorted JSON, so a reordered but equal value compares equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]]),
        )
      : inner,
  );
}

export function parseJsonObject(contents: string | null): JsonObject {
  if (contents === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new UnsupportedConfigError(
      "is not plain JSON (setup cannot keep comments or trailing commas)",
    );
  }
  if (!isRecord(value)) {
    throw new UnsupportedConfigError("is not a JSON object");
  }
  return value;
}

/** The object at `path`, or undefined when a step is missing; a step that is not an object cannot be edited. */
function objectAt(config: JsonObject, path: JsonPath): JsonObject | undefined {
  let current: JsonObject = config;
  for (const [index, key] of path.entries()) {
    const next = current[key];
    if (next === undefined) return undefined;
    if (!isRecord(next)) {
      throw new UnsupportedConfigError(
        `has a \`${path.slice(0, index + 1).join(".")}\` value that is not an object`,
      );
    }
    current = next;
  }
  return current;
}

function valueAt(config: JsonObject, path: JsonPath): unknown {
  return objectAt(config, path.slice(0, -1))?.[path[path.length - 1]];
}

function ensureObjectAt(config: JsonObject, path: JsonPath): JsonObject {
  let current = config;
  for (const key of path) {
    const next = current[key];
    if (isRecord(next)) {
      current = next;
    } else {
      const created: JsonObject = {};
      current[key] = created;
      current = created;
    }
  }
  return current;
}

function deleteAt(config: JsonObject, path: JsonPath): void {
  const parent = objectAt(config, path.slice(0, -1));
  if (parent) delete parent[path[path.length - 1]];
}

/**
 * A parsed JSON config whose servers live in an object at `serversPath`.
 * `earlier` is where an earlier layout kept the `lemma` entry: it is read
 * when the current entry is absent, and dropped when the server is set.
 */
function jsonServers(
  config: JsonObject,
  options: {
    serversPath: JsonPath;
    entry: (url: string, apiKey: string) => JsonObject;
    earlier?: JsonPath;
  },
): ParsedMcpConfig {
  const current = valueAt(config, [...options.serversPath, MCP_SERVER_NAME]);
  const earlier =
    options.earlier === undefined
      ? undefined
      : valueAt(config, options.earlier);
  return {
    existing: existingKeyOf(current ?? earlier, "headers"),
    set(url, apiKey) {
      const next = structuredClone(config);
      if (options.earlier !== undefined) deleteAt(next, options.earlier);
      ensureObjectAt(next, options.serversPath)[MCP_SERVER_NAME] =
        options.entry(url, apiKey);
      return {
        contents: `${JSON.stringify(next, null, 2)}\n`,
        replaced: current !== undefined || earlier !== undefined,
      };
    },
  };
}

/** A config whose servers sit in one JSON object, each entry built by `entry`. */
function jsonFormat(options: {
  serversPath: JsonPath;
  entry: (url: string, apiKey: string) => JsonObject;
}): McpConfigFormat {
  return {
    fileExtension: "json",
    parse: (contents) => jsonServers(parseJsonObject(contents), options),
  };
}

/**
 * `{"mcpServers": {"lemma": {url, headers}}}`: Cursor (`~/.cursor/mcp.json`,
 * this repo's MCP docs) and Pi (`~/.pi/agent/mcp.json`, Pi's MCP docs), and
 * the generic shape of setup's private MCP file.
 */
export const mcpServersJson = jsonFormat({
  serversPath: ["mcpServers"],
  entry: (url, apiKey) => ({ url, headers: headersOf(apiKey) }),
});

/**
 * OpenCode's `opencode.json`. Current releases read `mcp.servers.<name>`;
 * earlier ones read only `mcp.<name>` and would take `mcp.servers` for a
 * server named "servers", so the current layout is written only to a
 * config that already uses it. `oauth: false` stops OpenCode from starting
 * OAuth discovery against a server that takes an API key.
 */
export const opencodeJson: McpConfigFormat = {
  fileExtension: "json",
  parse(contents) {
    const config = parseJsonObject(contents);
    const remote = (url: string, apiKey: string): JsonObject => ({
      type: "remote",
      url,
      headers: headersOf(apiKey),
      oauth: false,
    });
    if (objectAt(config, ["mcp", "servers"]) === undefined) {
      return jsonServers(config, {
        serversPath: ["mcp"],
        // The earlier entry schema has `enabled`; the current one has
        // `disabled` and rejects fields it does not know.
        entry: (url, apiKey) => ({ ...remote(url, apiKey), enabled: true }),
      });
    }
    return jsonServers(config, {
      serversPath: ["mcp", "servers"],
      entry: remote,
      earlier: ["mcp", MCP_SERVER_NAME],
    });
  },
};

/**
 * OpenClaw's `openclaw.json`: `mcp.servers.<name>` with
 * `transport: "streamable-http"` (OpenClaw's MCP docs; without it OpenClaw
 * uses SSE). The file is JSON5, so one with comments or trailing commas is
 * left to the user.
 */
export const openclawJson = jsonFormat({
  serversPath: ["mcp", "servers"],
  entry: (url, apiKey) => ({
    url,
    transport: "streamable-http",
    headers: headersOf(apiKey),
  }),
});

function parsedToml(source: string): JsonObject {
  try {
    return parseToml(source);
  } catch {
    throw new UnsupportedConfigError("is not valid TOML");
  }
}

function withoutLemma(config: JsonObject): JsonObject {
  const copy = structuredClone(config);
  const servers = copy.mcp_servers;
  if (isRecord(servers)) {
    delete servers[MCP_SERVER_NAME];
    if (Object.keys(servers).length === 0) delete copy.mcp_servers;
  }
  return copy;
}

/** `source` without its `lemma` table, with a new one appended. */
function codexWithLemma(source: string, url: string, apiKey: string): string {
  const kept = withoutLemmaTable(source);
  return [
    ...kept,
    ...(kept.length > 0 ? [""] : []),
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `url = ${JSON.stringify(url)}`,
    `http_headers = { Authorization = ${JSON.stringify(`Bearer ${apiKey}`)} }`,
    "",
  ].join(lineEnding(source));
}

const CHECK_URL = "https://lemma.invalid/mcp/";
const CHECK_KEY = "lemma_check_0000000000000000";

/**
 * Codex's `config.toml`: a `[mcp_servers.lemma]` table with `url` and
 * `http_headers` (Codex's MCP docs). The edit removes the old table and
 * appends a new one, keeping every other line and comment. Whether that
 * edit is safe depends only on the file, so `parse` proves it once with a
 * stand-in entry: the result must parse, hold exactly that entry, and keep
 * everything else. A `lemma` server written inline, or an `mcp_servers`
 * that is not a table, fails the check.
 */
export const codexToml: McpConfigFormat = {
  fileExtension: "toml",
  parse(contents) {
    const source = contents ?? "";
    const before = parsedToml(source);
    let after: JsonObject;
    try {
      after = parseToml(codexWithLemma(source, CHECK_URL, CHECK_KEY));
    } catch {
      after = {};
    }
    const servers = isRecord(before.mcp_servers) ? before.mcp_servers : {};
    const written = isRecord(after.mcp_servers)
      ? after.mcp_servers[MCP_SERVER_NAME]
      : undefined;
    if (
      canonical(written) !==
        canonical({ url: CHECK_URL, http_headers: headersOf(CHECK_KEY) }) ||
      canonical(withoutLemma(before)) !== canonical(withoutLemma(after))
    ) {
      throw new UnsupportedConfigError(
        "defines the `lemma` MCP server or `mcp_servers` in a form setup cannot edit (use a `[mcp_servers.lemma]` table)",
      );
    }
    return {
      existing: existingKeyOf(servers[MCP_SERVER_NAME], "http_headers"),
      set: (url, apiKey) => ({
        contents: codexWithLemma(source, url, apiKey),
        replaced: servers[MCP_SERVER_NAME] !== undefined,
      }),
    };
  },
};

/**
 * Hermes' `config.yaml`: `mcp_servers.lemma` with `url` and `headers`
 * (Hermes' MCP docs). The YAML document model keeps comments and layout.
 */
export const hermesYaml: McpConfigFormat = {
  fileExtension: "yaml",
  parse(contents) {
    const document = parseDocument(contents ?? "");
    if (document.errors.length > 0) {
      throw new UnsupportedConfigError("is not valid YAML");
    }
    if (document.contents !== null && !isMap(document.contents)) {
      throw new UnsupportedConfigError("is not a YAML mapping");
    }
    const servers = document.get("mcp_servers", true);
    const empty =
      servers === undefined || (isScalar(servers) && servers.value === null);
    if (!empty && !isMap(servers)) {
      throw new UnsupportedConfigError(
        "has an `mcp_servers` value that is not a mapping",
      );
    }
    const plain: unknown = document.toJS();
    const plainServers = isRecord(plain) ? plain.mcp_servers : undefined;
    return {
      existing: existingKeyOf(
        isRecord(plainServers) ? plainServers[MCP_SERVER_NAME] : undefined,
        "headers",
      ),
      set(url, apiKey) {
        const entry = { url, headers: headersOf(apiKey) };
        const next = document.clone();
        const nextServers = next.get("mcp_servers", true);
        const replaced = isMap(nextServers) && nextServers.has(MCP_SERVER_NAME);
        if (isMap(nextServers)) {
          nextServers.set(MCP_SERVER_NAME, next.createNode(entry));
        } else {
          next.set(
            "mcp_servers",
            next.createNode({ [MCP_SERVER_NAME]: entry }),
          );
        }
        return { contents: next.toString(), replaced };
      },
    };
  },
};
