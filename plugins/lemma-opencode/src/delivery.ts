// Bounds one delivery, including reading an error response's body, by the
// time left before the flush deadline, which the SDK's per-attempt cap does
// not know.
export function createDeliveryFetch(
  fetchImplementation: typeof fetch,
  remainingMilliseconds: number,
): typeof fetch {
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
      }, remainingMilliseconds);
    });
    const requestAndBody = (async () => {
      const response = await fetchImplementation(request, { ...init, signal });
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
