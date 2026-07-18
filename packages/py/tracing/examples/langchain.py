from langchain_openai import ChatOpenAI
from uselemma_tracing import langchain

lemma_handler = langchain(
    agent_name="support-agent",
    thread_id_key="conversation_id",
    user_id_key="user_id",
)


def call_langchain(user_message: str, conversation_id: str, user_id: str | None = None):
    model = ChatOpenAI(model="gpt-4o", callbacks=[lemma_handler])
    metadata = {"conversation_id": conversation_id}
    if user_id:
        metadata["user_id"] = user_id
    response = model.invoke(
        user_message,
        config={"metadata": metadata},
    )
    return response.content


def shutdown_langchain():
    lemma_handler.shutdown()
