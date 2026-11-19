import packageJson from "../package.json" with { type: "json" };

export const PLUGIN_USER_AGENT = `${packageJson.name}/${packageJson.version}`;

// The tracing SDK has no User-Agent option, matching the Python SDK, so the
// plugin relabels its own requests here. An SDK option could replace these
// copies; nothing depends on that.
export function withPluginUserAgent(
  fetchImplementation: typeof fetch,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", PLUGIN_USER_AGENT);
    return fetchImplementation(input, { ...init, headers });
  };
}
