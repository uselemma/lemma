import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { langGraph } from "@uselemma/tracing";

const GraphState = Annotation.Root({
  input: Annotation<string>(),
  output: Annotation<string | undefined>(),
});

const graph = new StateGraph(GraphState)
  .addNode("answer", async (state) => ({
    output: `You said: ${state.input}`,
  }))
  .addEdge(START, "answer")
  .addEdge("answer", END)
  .compile();

/** langGraph() is a LangChain callback adapter with LangGraph defaults. */
const lemmaHandler = langGraph({
  agentName: "support-graph",
  threadIdKey: "thread_id",
});

export async function callLangGraph(
  userMessage: string,
  threadId?: string,
) {
  const result = await graph.invoke(
    { input: userMessage },
    {
      callbacks: [lemmaHandler],
      metadata: threadId ? { thread_id: threadId } : undefined,
    },
  );
  await lemmaHandler.flush();

  return result.output;
}

export async function shutdownLangGraph() {
  await lemmaHandler.shutdown();
}
