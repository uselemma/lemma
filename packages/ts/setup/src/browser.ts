import { spawn } from "node:child_process";
import { win32 } from "node:path";

/**
 * Absolute launchers, never a shell: the URL comes from the server and must
 * not be interpreted as a command.
 */
export function browserLaunchCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { file: string; args: string[] } {
  if (platform === "darwin") return { file: "/usr/bin/open", args: [url] };
  if (platform === "win32") {
    const systemRoot =
      env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? env.WINDIR;
    const normalizedSystemRoot = systemRoot && win32.normalize(systemRoot);
    if (
      !normalizedSystemRoot ||
      !/^[A-Za-z]:\\Windows$/i.test(normalizedSystemRoot)
    ) {
      throw new Error("Could not resolve the trusted Windows browser launcher");
    }
    return {
      file: win32.join(normalizedSystemRoot, "System32", "rundll32.exe"),
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { file: "/usr/bin/xdg-open", args: [url] };
}

export async function launchBrowser(url: string): Promise<void> {
  const command = browserLaunchCommand(url);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}
