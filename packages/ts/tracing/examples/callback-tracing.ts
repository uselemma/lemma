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
    messages: [{ role: "user", content: message }],
    docs,
  };
}

export async function runSupportAgent(userMessage: string) {
  return lemma.trace(
    {
      name: "support-agent",
      input: userMessage,
      threadId: "thread-123",
      userId: "user-456",
    },
    async (trace) => {
      const docs = await searchDocs(userMessage);

      trace.recordTool({
        name: "search_docs",
        input: { query: userMessage },
        output: docs,
        toolParameters: { query: "string" },
      });

      const response = await callModel(userMessage, docs);
      trace.recordGeneration({
        name: "draft-reply",
        input: response.messages,
        output: response.text,
        model: "gpt-4o",
        llmInputMessages: response.messages,
        llmInvocationParameters: { temperature: 0.2 },
      });

      return response.text;
    },
  );
}
