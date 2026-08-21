import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapterDispose: vi.fn(async () => undefined),
  flushPendingTurns: vi.fn(async () => 0),
}));

vi.mock("./adapter.js", () => ({
  createOpenCodeAdapter: () => ({
    afterTool: () => undefined,
    beforeTool: () => undefined,
    chatMessage: async () => undefined,
    dispose: mocks.adapterDispose,
    event: async () => undefined,
  }),
}));

vi.mock("./flush.js", () => ({
  DEFAULT_FLUSH_TIMEOUT_MS: 100,
  flushPendingTurns: mocks.flushPendingTurns,
}));

import { LemmaPlugin } from "./plugin-entry.js";

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.adapterDispose.mockReset().mockResolvedValue(undefined);
  mocks.flushPendingTurns.mockReset().mockResolvedValue(0);
});

describe("OpenCode plugin shutdown", () => {
  it("shares one shutdown deadline with the final flush", async () => {
    let releaseStartupFlush: (() => void) | undefined;
    mocks.flushPendingTurns.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          releaseStartupFlush = () => resolve(0);
        }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const hooks = await LemmaPlugin({
      client: {},
      directory: "/repo",
    } as never);
    expect(mocks.flushPendingTurns).toHaveBeenCalledWith({
      warn: expect.any(Function),
      deadline: undefined,
    });

    const disposal = hooks.dispose?.();
    releaseStartupFlush?.();
    await disposal;

    expect(mocks.adapterDispose).toHaveBeenCalledOnce();
    expect(mocks.flushPendingTurns).toHaveBeenNthCalledWith(2, {
      warn: expect.any(Function),
      deadline: 1_100,
    });
  });
});
