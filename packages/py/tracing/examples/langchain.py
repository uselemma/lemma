from langchain_openai import ChatOpenAI
from uselemma_tracing import langchain

lemma_callbacks = [langchain(agent_name="support-agent")]


def call_langchain(user_message: str):
    model = ChatOpenAI(model="gpt-4o", callbacks=lemma_callbacks)
    response = model.invoke(user_message)
    return response.content
