import packageJson from "../package.json" with { type: "json" };

const PLUGIN_USER_AGENT = `${packageJson.name}/${packageJson.version}`;

// The tracing SDK takes no User-Agent option, matching the Python SDK, so the
// plugin relabels its own requests here. An SDK option could replace these
// copies.
export function withPluginUserAgent(
  fetchImplementation: typeof fetch,
): typeof fetch {
  return (input, init) => {
    // As in fetch, init.headers replaces a Request's own headers.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("User-Agent", PLUGIN_USER_AGENT);
    return fetchImplementation(input, { ...init, headers });
  };
}
