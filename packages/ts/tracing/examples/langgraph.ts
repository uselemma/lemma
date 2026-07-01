import { StateGraph, START, END } from "@langchain/langgraph";
import { langGraph } from "@uselemma/tracing";

type GraphState = {
  input: string;
  output?: string;
};

const graph = new StateGraph<GraphState>()
  .addNode("answer", async (state) => ({
    output: `You said: ${state.input}`,
  }))
  .addEdge(START, "answer")
  .addEdge("answer", END)
  .compile();

export async function callLangGraph(userMessage: string) {
  const result = await graph.invoke(
    { input: userMessage },
    { callbacks: [langGraph({ agentName: "support-graph" })] },
  );

  return result.output;
}
