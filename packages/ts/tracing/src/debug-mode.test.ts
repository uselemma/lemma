import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableDebugMode,
  disableDebugMode,
  isDebugModeEnabled,
  lemmaDebug,
} from "./debug-mode";

describe("debug-mode", () => {
  beforeEach(() => {
    disableDebugMode();
    delete process.env["LEMMA_DEBUG"];
  });

  afterEach(() => {
    disableDebugMode();
    delete process.env["LEMMA_DEBUG"];
  });

  it("is disabled by default", () => {
    expect(isDebugModeEnabled()).toBe(false);
  });

  it("enableDebugMode activates it", () => {
    enableDebugMode();
    expect(isDebugModeEnabled()).toBe(true);
  });

  it("disableDebugMode deactivates it", () => {
    enableDebugMode();
    disableDebugMode();
    expect(isDebugModeEnabled()).toBe(false);
  });

  it("LEMMA_DEBUG=true env var activates it", () => {
    process.env["LEMMA_DEBUG"] = "true";
    expect(isDebugModeEnabled()).toBe(true);
  });

  it("LEMMA_DEBUG with other value does not activate", () => {
    process.env["LEMMA_DEBUG"] = "1";
    expect(isDebugModeEnabled()).toBe(false);
  });

  it("lemmaDebug logs when enabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();

    lemmaDebug("client", "trace started", { runId: "abc" });

    expect(spy).toHaveBeenCalledWith("[LEMMA:client] trace started", { runId: "abc" });
    spy.mockRestore();
  });

  it("lemmaDebug logs without data object", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();

    lemmaDebug("processor", "shutdown called");

    expect(spy).toHaveBeenCalledWith("[LEMMA:processor] shutdown called");
    spy.mockRestore();
  });

  it("lemmaDebug does NOT log when disabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    lemmaDebug("client", "trace started", { runId: "abc" });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("client debug logging", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
  });

  it("lemmaDebug logs when activated via LEMMA_DEBUG env var", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env["LEMMA_DEBUG"] = "true";

    lemmaDebug("client", "trace started", { agentName: "test", runId: "xyz" });

    expect(spy).toHaveBeenCalledWith(
      "[LEMMA:client] trace started",
      { agentName: "test", runId: "xyz" }
    );

    delete process.env["LEMMA_DEBUG"];
    spy.mockRestore();
  });

  it("lemmaDebug with both code API and env var enabled logs once per call", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    enableDebugMode();
    process.env["LEMMA_DEBUG"] = "true";

    lemmaDebug("client", "trace queued for ingest", { runId: "r1" });

    expect(spy).toHaveBeenCalledTimes(1);

    delete process.env["LEMMA_DEBUG"];
    spy.mockRestore();
  });
});
