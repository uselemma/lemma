let debugModeEnabled = false;

export function enableDebugMode(): void {
  debugModeEnabled = true;
}

export function disableDebugMode(): void {
  debugModeEnabled = false;
}

export function isDebugModeEnabled(): boolean {
  return debugModeEnabled || process.env["LEMMA_DEBUG"] === "true";
}

export function lemmaDebug(prefix: string, msg: string, data?: Record<string, unknown>): void {
  if (!isDebugModeEnabled()) return;
  if (data !== undefined) {
    console.log(`[LEMMA:${prefix}] ${msg}`, data);
  } else {
    console.log(`[LEMMA:${prefix}] ${msg}`);
  }
}
