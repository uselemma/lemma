import packageJson from "../package.json" with { type: "json" };

export const PLUGIN_USER_AGENT = `${packageJson.name}/${packageJson.version}`;

// For requests that bypass the tracing SDK's Lemma client, which sends
// PLUGIN_USER_AGENT through its userAgent option.
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
