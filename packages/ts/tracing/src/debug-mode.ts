let debugModeEnabled = false;

/** Accepts `"1"` (preferred) and `"true"` (backwards compatible). Case-sensitive. */
function isEnvFlagEnabled(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true";
}

export function enableDebugMode(): void {
  debugModeEnabled = true;
}

export function disableDebugMode(): void {
  debugModeEnabled = false;
}

export function isDebugModeEnabled(): boolean {
  return debugModeEnabled || isEnvFlagEnabled("LEMMA_DEBUG");
}

export function isDebugVerifyEnabled(): boolean {
  return isEnvFlagEnabled("LEMMA_DEBUG_VERIFY");
}

export function lemmaDebug(prefix: string, msg: string, data?: Record<string, unknown>): void {
  if (!isDebugModeEnabled()) return;
  if (data !== undefined) {
    console.log(`[LEMMA:${prefix}] ${msg}`, data);
  } else {
    console.log(`[LEMMA:${prefix}] ${msg}`);
  }
}
