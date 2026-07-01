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

async function callModel(message: string, docs: unknown[]) {
  return {
    text: `Answer for ${message}`,
    docs,
  };
}

export async function runWithHandles(userMessage: string) {
  const trace = lemma.trace({
    name: "support-agent",
    input: userMessage,
    threadId: "thread-123",
  });

  const retrieval = trace.startSpan({
    name: "retrieve-context",
    input: { query: userMessage },
  });

  const docs = await searchDocs(userMessage);
  retrieval.recordTool({
    name: "search_docs",
    input: { query: userMessage },
    output: docs,
    toolParameters: { query: "string" },
  });
  retrieval.end({
    output: { count: docs.length },
  });

  const response = await callModel(userMessage, docs);
  trace.recordGeneration({
    name: "draft-reply",
    output: response.text,
    model: "gpt-4o",
  });

  await trace.end({ output: response.text });
}
