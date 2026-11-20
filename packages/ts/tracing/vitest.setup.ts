import { afterEach, vi } from "vitest";
import { resetDroppedTraceWarnings } from "./src/dropped-traces";

// The dropped-trace warning budget is process-wide; each test starts fresh.
afterEach(() => {
  resetDroppedTraceWarnings();
  vi.useRealTimers();
});
