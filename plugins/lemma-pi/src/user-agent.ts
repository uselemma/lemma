import packageJson from "../package.json" with { type: "json" };

/** This plugin's identity on every request it makes; the build inlines it. */
export const PLUGIN_USER_AGENT = `${packageJson.name}/${packageJson.version}`;

/**
 * `init` with this plugin's User-Agent in place of any other, such as the
 * tracing SDK's. The SDK sends plain-object headers, which stay plain objects
 * with their other names unchanged.
 */
export function withPluginUserAgent(init: RequestInit = {}): RequestInit {
  const { headers } = init;
  if (headers instanceof Headers || Array.isArray(headers)) {
    const merged = new Headers(headers);
    merged.set("User-Agent", PLUGIN_USER_AGENT);
    return { ...init, headers: merged };
  }
  const others = Object.entries(headers ?? {}).filter(
    ([name]) => name.toLowerCase() !== "user-agent",
  );
  return {
    ...init,
    headers: { ...Object.fromEntries(others), "User-Agent": PLUGIN_USER_AGENT },
  };
}
