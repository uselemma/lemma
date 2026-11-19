import { withPluginUserAgent } from "./user-agent.js";

export const DELIVERY_TIMEOUT_MS = 10_000;

export function createDeliveryFetch(
  fetchImplementation: typeof fetch = fetch,
  timeoutMilliseconds = DELIVERY_TIMEOUT_MS,
): typeof fetch {
  const send = withPluginUserAgent(fetchImplementation);
  return async (request, init) => {
    const controller = new AbortController();
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Lemma OpenCode trace delivery timed out"));
      }, timeoutMilliseconds);
    });
    const requestAndBody = (async () => {
      const response = await send(request, { ...init, signal });
      if (response.ok || !response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    })();
    try {
      return await Promise.race([requestAndBody, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
