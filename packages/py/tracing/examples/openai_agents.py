from agents import Agent, Runner
from uselemma_tracing import instrument_openai_agents

# Register once before running agents. Credentials default to LEMMA_API_KEY /
# LEMMA_PROJECT_ID. Optional identity keys promote metadata onto the Lemma root.
processor = instrument_openai_agents(
    metadata={"service": "support"},
    thread_id_key="thread_id",
    user_id_key="user_id",
)

agent = Agent(
    name="support-agent",
    instructions="Answer customer questions clearly and concisely.",
)


async def call_agent(user_message: str):
    result = await Runner.run(agent, user_message)
    return result.final_output


async def shutdown():
    # Finalize any still-open traces exactly once (safe if on_trace_end already ran).
    processor.force_flush()


# Equivalent without instrument helper:
# processor = openai_agents()
# from agents import add_trace_processor
# add_trace_processor(processor)
