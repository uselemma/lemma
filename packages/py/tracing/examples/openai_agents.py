from agents import Agent, Runner
from uselemma_tracing import instrument_openai_agents

instrument_openai_agents()

agent = Agent(
    name="support-agent",
    instructions="Answer customer questions clearly and concisely.",
)


async def call_agent(user_message: str):
    result = await Runner.run(agent, user_message)
    return result.final_output
