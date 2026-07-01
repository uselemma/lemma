import { Lemma } from "@uselemma/tracing";

const lemma = new Lemma({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
});

async function searchDocs(query: string) {
  return [
    { id: "doc-1", text: "Orders ship in two business days.", score: 0.91 },
  ];
}

export async function runDetachedHelpers(userMessage: string) {
  const trace = lemma.trace({
    name: "support-agent",
    input: userMessage,
  });

  const retrieve = lemma.startSpan({
    traceId: trace.id,
    name: "retrieve-context",
    input: { query: userMessage },
  });

  const docs = await searchDocs(userMessage);

  lemma.recordTool({
    traceId: trace.id,
    parentSpanId: retrieve.id,
    name: "search_docs",
    input: { query: userMessage },
    output: docs,
    toolParameters: { query: "string" },
  });

  retrieve.end({
    output: { count: docs.length },
  });

  await trace.end({ output: `Found ${docs.length} document(s).` });
}
