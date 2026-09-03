import { listDocs, readDoc } from "./docs";

export async function executeDocsTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  if (name === "list_docs") {
    return listDocs();
  }
  if (name === "read_doc") {
    const url = args.url;
    if (typeof url !== "string" || !url.trim()) {
      throw new Error("read_doc requires a string url argument");
    }
    return readDoc(url);
  }
  throw new Error(`Unknown tool: ${name}`);
}
