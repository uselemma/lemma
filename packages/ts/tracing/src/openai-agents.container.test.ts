import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody } from "../test-helpers";
import { disableDebugMode } from "./debug-mode";
import { openAIAgents } from "./openai-agents";

describe("openAIAgents container spans", () => {
  beforeEach(() => {
    disableDebugMode();
  });

  afterEach(() => {
    disableDebugMode();
    vi.restoreAllMocks();
  });

  it("fills agent, task, and turn spans from their own child generations", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });
    const traceId = "trace_containers";

    await processor.onTraceStart({ traceId, name: "support-agent" });
    await processor.onSpanStart({
      traceId,
      spanId: "span_turn",
      spanData: { type: "turn", name: "turn" },
    });
    await processor.onSpanStart({
      traceId,
      spanId: "span_task",
      parentId: "span_turn",
      spanData: { type: "task", name: "task" },
    });
    await processor.onSpanStart({
      traceId,
      spanId: "span_agent_a",
      parentId: "span_task",
      spanData: { type: "agent", name: "agent-a" },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_gen_a",
      parentId: "span_agent_a",
      spanData: {
        type: "generation",
        input: "ask A",
        output: [{ role: "assistant", content: "reply A" }],
      },
    });
    await processor.onSpanStart({
      traceId,
      spanId: "span_agent_b",
      parentId: "span_task",
      spanData: { type: "agent", name: "agent-b" },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_gen_b",
      parentId: "span_agent_b",
      spanData: {
        type: "generation",
        input: "ask B",
        output: [{ role: "assistant", content: "reply B" }],
      },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_agent_a",
      parentId: "span_task",
      spanData: { type: "agent", name: "agent-a" },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_agent_b",
      parentId: "span_task",
      spanData: { type: "agent", name: "agent-b" },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_task",
      parentId: "span_turn",
      spanData: { type: "task", name: "task" },
    });
    await processor.onSpanEnd({
      traceId,
      spanId: "span_turn",
      spanData: { type: "turn", name: "turn" },
    });
    await processor.onTraceEnd({ traceId, name: "support-agent" });
    await processor.forceFlush();

    const body = jsonBody(fetchMock.mock.calls[0]);
    const byId = Object.fromEntries(
      body.trace.spans.map((span: { id: string }) => [span.id, span]),
    );
    expect(byId.span_agent_a).toMatchObject({
      input: "ask A",
      output: "reply A",
    });
    expect(byId.span_agent_b).toMatchObject({
      input: "ask B",
      output: "reply B",
    });
    expect(byId.span_task).toMatchObject({
      input: "ask A",
      output: "reply B",
    });
    expect(byId.span_turn).toMatchObject({
      input: "ask A",
      output: "reply B",
    });
    expect(body.trace.input).toBe("ask A");
    expect(body.trace.output).toBe("reply B");
  });

  it("keeps an agent span's own input when a child generation has another", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({ traceId: "trace_owned", name: "agent" });
    await processor.onSpanStart({
      traceId: "trace_owned",
      spanId: "span_agent",
      spanData: { type: "agent", name: "agent", input: "owned" },
    });
    await processor.onSpanEnd({
      traceId: "trace_owned",
      spanId: "span_gen",
      parentId: "span_agent",
      spanData: {
        type: "generation",
        input: "child ask",
        output: [{ role: "assistant", content: "child reply" }],
      },
    });
    await processor.onSpanEnd({
      traceId: "trace_owned",
      spanId: "span_agent",
      spanData: { type: "agent", name: "agent", input: "owned" },
    });
    await processor.onTraceEnd({ traceId: "trace_owned", name: "agent" });
    await processor.forceFlush();

    const agent = jsonBody(fetchMock.mock.calls[0]).trace.spans.find(
      (span: { id?: string }) => span.id === "span_agent",
    );
    expect(agent).toMatchObject({ input: "owned", output: "child reply" });
  });

  it("fills an agent span when its model call ends afterward", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    const processor = openAIAgents({
      apiKey: "key",
      projectId: "10000000-0000-0000-0000-000000000001",
      fetch: fetchMock as typeof fetch,
    });

    await processor.onTraceStart({
      traceId: "trace_late_child",
      name: "agent",
    });
    await processor.onSpanStart({
      traceId: "trace_late_child",
      spanId: "span_agent",
      spanData: { type: "agent", name: "agent" },
    });
    await processor.onSpanEnd({
      traceId: "trace_late_child",
      spanId: "span_agent",
      spanData: { type: "agent", name: "agent" },
    });
    await processor.onSpanEnd({
      traceId: "trace_late_child",
      spanId: "span_gen",
      parentId: "span_agent",
      spanData: {
        type: "generation",
        input: "late ask",
        output: [{ role: "assistant", content: "late reply" }],
      },
    });
    await processor.onTraceEnd({ traceId: "trace_late_child", name: "agent" });
    await processor.forceFlush();

    const agent = jsonBody(fetchMock.mock.calls[0]).trace.spans.find(
      (span: { id?: string }) => span.id === "span_agent",
    );
    expect(agent).toMatchObject({ input: "late ask", output: "late reply" });
  });
});
