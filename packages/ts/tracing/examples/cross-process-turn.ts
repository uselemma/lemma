import { Lemma, attachTurn } from "@uselemma/tracing";

/**
 * Host + child (E2B-style) as two functions with no shared memory.
 * The journal is the only thing that crosses the process boundary.
 */
const lemma = new Lemma({
  apiKey: process.env.LEMMA_API_KEY,
  projectId: process.env.LEMMA_PROJECT_ID,
});

function runInSandbox(tokenJson: string, userMessage: string) {
  const local = attachTurn(tokenJson);
  local.recordTool({
    name: "search_docs",
    input: { query: userMessage },
    output: [{ title: "Shipping" }],
  });
  const generation = local.startGeneration({
    name: "answer",
    model: "gpt-4o",
    input: userMessage,
  });
  generation.end({ output: "It arrives Friday." });
  return local.records();
}

export async function runHostAndSandbox(userMessage: string) {
  const turn = lemma.startTurn({
    name: "agent-turn",
    input: userMessage,
    threadId: "thread-123",
  });
  const sandbox = turn.startSpan({ name: "e2b-sandbox" });

  const journal = runInSandbox(
    JSON.stringify(turn.export({ parentSpanId: sandbox.id })),
    userMessage,
  );
  turn.apply(journal);
  sandbox.end({ output: { ok: true } });
  await turn.end({ output: "It arrives Friday." });
}
