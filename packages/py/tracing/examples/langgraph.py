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


def call_langgraph(user_message: str):
    result = graph.invoke(
        {"input": user_message},
        {"callbacks": [langgraph(agent_name="support-graph")]},
    )
    return result["output"]
