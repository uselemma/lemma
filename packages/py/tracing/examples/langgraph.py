from typing_extensions import TypedDict
from langgraph.graph import END, START, StateGraph
from uselemma_tracing import langgraph


class GraphState(TypedDict):
    input: str
    output: str


def answer(state: GraphState):
    return {"output": f"You said: {state['input']}"}


graph = (
    StateGraph(GraphState)
    .add_node("answer", answer)
    .add_edge(START, "answer")
    .add_edge("answer", END)
    .compile()
)

# langgraph() is a LangChain callback adapter with LangGraph defaults.
lemma_handler = langgraph(
    agent_name="support-graph",
    thread_id_key="thread_id",
)


def call_langgraph(user_message: str, thread_id: str | None = None):
    config: dict = {"callbacks": [lemma_handler]}
    if thread_id:
        config["metadata"] = {"thread_id": thread_id}
    result = graph.invoke({"input": user_message}, config)
    return result["output"]


def shutdown_langgraph():
    lemma_handler.shutdown()
