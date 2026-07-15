# uselemma-tracing

HTTP tracing SDK for AI agents. The primary API sends trace payloads directly to Lemma over HTTP.

## Installation

```bash
pip install uselemma-tracing
```

## Quick Start

```python
from uselemma_tracing import Lemma

lemma = Lemma()

def run(trace):
    docs = search_docs(user_message)
    trace.record_tool(
        name="search_docs",
        input={"query": user_message},
        output=docs,
        tool_parameters={"query": "string"},
    )

    response = call_model(user_message, docs)
    trace.record_generation(
        name="draft-reply",
        input=response.messages,
        output=response.text,
        model="gpt-4o",
        llm_input_messages=[{"role": "user", "content": user_message}],
        llm_invocation_parameters={"temperature": 0.2},
    )

    return response.text

answer = lemma.trace(
    "support-agent",
    run,
    input=user_message,
    thread_id=conversation_id,
    user_id=user.id,
)
```

`lemma.trace()` measures the trace from callback start to completion. Use
`async_trace()` for async callbacks.

## Live Spans

```python
def run(trace):
    span = trace.start_span(name="retrieve-context", input=query)
    try:
        docs = retrieve(query)
        span.end(output={"count": len(docs)})
        return docs
    except Exception as error:
        span.end(status="ERROR", error=error)
        raise
```

Live handles know their start time when created and their end time when
`.end()` is called, so you usually do not pass `duration_ms`. Pass
`duration_ms` only when replaying historical work or overriding the measured
duration with a value from another timer.

For one-off records where you already measured the work, pass `duration_ms` on
the record call:

```python
trace.record_generation(
    name="answer",
    output=text,
    model="gpt-4o",
    duration_ms=measured_model_ms,
)
```

The same handle pattern is available for tool calls and generations:

```python
tool = trace.start_tool(name="search_docs", input={"query": query})
docs = search_docs(query)
tool.end(output=docs)

generation = trace.start_generation(name="answer", input=messages)
response = call_model(messages)
generation.end(output=response.text)
```

## Sending a Trace You Built Yourself

`trace()` assumes the client owns the trace lifecycle within a single process.
When the producer lives elsewhere — a cross-process buffer, a queue worker, a
batch backfill — build a `TraceContext` yourself and deliver it with `ingest()`:

```python
from uselemma_tracing import Lemma, TraceContext

lemma = Lemma()

context = TraceContext(
    id=turn_id,  # stable id for this execution (use for retries)
    name=prompt,
    input=prompt,
    thread_id=conversation_id,
)
context.record_tool(name="search_docs", input=query, output=docs, duration_ms=25)
context.record_generation(name="answer", model="gpt-4o", output=final_answer)
context.output(final_answer)

lemma.ingest(context, started_at=started_at)
```

`ingest()` POSTs one payload. Deliver **one complete trace** when the execution
(agent turn) finishes: root input/output, thread/user, and all child spans in
one call. This is required — patching a trace over time is not currently
supported.

`ingest()` is not an incremental merge API: omitted root fields do not preserve
prior values, and after Lemma processes the trace once, a later re-delivery does
not re-run issue extraction (occasional late child spans may still append to the
tree for display). Retries of the same complete payload are safe — already-stored
span IDs are skipped — so a failed send can be retried as-is. It raises on a
non-2xx response and never mutates the trace's status.

## OpenAI Agents SDK

Install the OpenAI Agents extra and register the Lemma processor:

```bash
pip install "uselemma-tracing[openai-agents]" openai-agents
```

```python
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
```

The processor creates one Lemma trace for each OpenAI Agents trace. Generation
spans become Lemma generations, function spans become Lemma tool spans, and
parent IDs are preserved so tools stay nested under the generation or agent
span that called them.

Enable debug mode to validate live span shape while developing:

```python
from uselemma_tracing import enable_debug_mode

enable_debug_mode()
```

Use `openai_agents(record_inputs=False, record_outputs=False)` when you need a
processor that avoids sending prompts, tool inputs, tool outputs, and generated
text.

## LangChain and LangGraph

Install the optional integration dependency and pass `langchain()` as a callback
handler:

```bash
pip install "uselemma-tracing[langchain]" langchain-openai
```

```python
from langchain_openai import ChatOpenAI
from uselemma_tracing import langchain

model = ChatOpenAI(
    model="gpt-4o",
    callbacks=[langchain(agent_name="support-agent")],
)

response = model.invoke(user_message)
```

LangGraph uses LangChain callbacks too:

```bash
pip install "uselemma-tracing[langgraph]"
```

```python
from uselemma_tracing import langgraph

result = graph.invoke(
    {"input": user_message},
    {"callbacks": [langgraph(agent_name="support-graph")]},
)
```

The handler creates one Lemma trace for the root chain/graph run, records LLM
calls as generations, tools as tool spans, retrievers as spans, and nested
chains or graph nodes as child spans.

Use `langchain(record_inputs=False, record_outputs=False)` or
`langgraph(record_inputs=False, record_outputs=False)` to avoid sending prompts,
tool inputs, tool outputs, or generated text.

## Supported Contract Fields

Use native SDK keyword arguments for OpenInference-style fields:

- LLM: `llm_model_name`, `llm_provider`, `llm_system`,
  `llm_invocation_parameters`, `llm_input_messages`, `llm_output_messages`,
  `llm_tools`, token counts, and prompt template fields
- tools: `tool_description`, `tool_parameters`
- embeddings and rerankers: `embedding_model_name`,
  `embedding_invocation_parameters`, `embedding_embeddings`,
  `reranker_model_name`, `reranker_input_documents`,
  `reranker_output_documents`

Use `attributes` for raw attributes that do not yet have a native SDK keyword.

## Configuration

| Option       | Environment variable | Default                   |
| ------------ | -------------------- | ------------------------- |
| `api_key`    | `LEMMA_API_KEY`      | Required                  |
| `project_id` | `LEMMA_PROJECT_ID`   | Required                  |
| `base_url`   | none                 | `https://api.uselemma.ai` |

The SDK sends to `{base_url}/traces/ingest`.

You can pass configuration directly to the constructor instead of using
environment variables:

```python
lemma = Lemma(
    api_key="sk_...",
    project_id="proj_...",
    base_url="https://api.uselemma.ai",
)
```

## Debug Mode

Debug mode logs trace starts, span starts, span completions, send attempts, and
send results as they happen:

```python
from uselemma_tracing import enable_debug_mode

enable_debug_mode()
```

You can also set `LEMMA_DEBUG=1` (`true` also works). Use this when validating that spans are
created in the expected order and the SDK is sending to the intended URL.

## License

MIT
