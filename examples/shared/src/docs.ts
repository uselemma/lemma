const DOCS_ORIGIN = "https://docs.uselemma.ai";
const DOCS_INDEX = `${DOCS_ORIGIN}/llms.txt`;

function assertOk(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText}`);
  }
}

export async function listDocs(): Promise<string> {
  const response = await fetch(DOCS_INDEX);
  assertOk(response, "list_docs");
  return response.text();
}

export function toMarkdownDocsUrl(url: string): string {
  const trimmed = url.trim();
  const href = trimmed.startsWith("/") ? `${DOCS_ORIGIN}${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new Error(
      `read_doc expected a docs.uselemma.ai URL or path, got ${JSON.stringify(url)}`,
    );
  }
  if (parsed.origin !== DOCS_ORIGIN) {
    throw new Error("read_doc only accepts https://docs.uselemma.ai URLs");
  }
  if (!parsed.pathname.endsWith(".md")) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}.md`;
  }
  return parsed.toString();
}

export async function readDoc(url: string): Promise<string> {
  const markdownUrl = toMarkdownDocsUrl(url);
  const response = await fetch(markdownUrl);
  assertOk(response, "read_doc");
  return response.text();
}
