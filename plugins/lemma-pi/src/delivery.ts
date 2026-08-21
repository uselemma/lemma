const DELIVERY_TIMEOUT_MS = 10_000;

export function createDeliveryFetch(
  fetchImplementation: typeof fetch = fetch,
  timeoutMilliseconds = DELIVERY_TIMEOUT_MS,
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
        reject(new Error("Lemma Pi trace delivery timed out"));
      }, timeoutMilliseconds);
    });
    try {
      return await Promise.race([
        fetchImplementation(request, { ...init, signal }),
        timedOut,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}
