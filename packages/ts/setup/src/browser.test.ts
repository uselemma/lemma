import { describe, expect, it } from "vitest";

import { browserLaunchCommand } from "./browser.js";

describe("browserLaunchCommand", () => {
  it("uses absolute launchers and passes the URL as one argument", () => {
    expect(browserLaunchCommand("https://example.com", "darwin")).toEqual({
      file: "/usr/bin/open",
      args: ["https://example.com"],
    });
    expect(browserLaunchCommand("https://example.com", "linux")).toEqual({
      file: "/usr/bin/xdg-open",
      args: ["https://example.com"],
    });
    expect(
      browserLaunchCommand("https://example.com/&calc.exe", "win32", {
        SystemRoot: "C:\\Windows",
      }),
    ).toEqual({
      file: "C:\\Windows\\System32\\rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://example.com/&calc.exe"],
    });
  });

  it("rejects an untrusted Windows launcher root", () => {
    expect(() =>
      browserLaunchCommand("https://example.com", "win32", {
        SystemRoot: "C:\\Temp",
      }),
    ).toThrow("trusted Windows browser launcher");
  });
});
