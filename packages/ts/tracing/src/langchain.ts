import {
  Lemma,
  type LemmaClientOptions,
  type SpanHandle,
  type TraceHandle,
} from "./client";
import { toolResultError } from "./tool-result";

type RunId = string;

type Serialized = {
  id?: string[];
  name?: string;
  kwargs?: Record<string, unknown>;
  [key: string]: unknown;
};

type LLMResult = {
  generations?: unknown[][];
  llmOutput?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LangChainIntegrationOptions = {
  lemma?: Lemma;
  apiKey?: LemmaClientOptions["apiKey"];
  projectId?: LemmaClientOptions["projectId"];
  baseUrl?: LemmaClientOptions["baseUrl"];
  fetch?: LemmaClientOptions["fetch"];
  agentName?: string;
  metadata?: Record<string, unknown>;
  recordInputs?: boolean;
  recordOutputs?: boolean;
};

type StoredRun = {
  handle?: SpanHandle;
  trace?: TraceHandle;
  parentRunId?: string;
  type: "chain" | "llm" | "tool" | "retriever";
};

function serializedName(serialized: Serialized | undefined, fallback: string) {
  if (typeof serialized?.name === "string" && serialized.name) {
    return serialized.name;
  }
  const id = serialized?.id;
  if (Array.isArray(id) && id.length > 0) {
    return String(id[id.length - 1]);
  }
  return fallback;
}

function modelName(serialized: Serialized | undefined) {
  const kwargs = serialized?.kwargs;
  const value =
    kwargs?.model ??
    kwargs?.modelName ??
    kwargs?.model_name ??
    kwargs?.model_id ??
    serialized?.model ??
    serialized?.modelName ??
    serialized?.model_name ??
    serialized?.model_id;
  return typeof value === "string" ? value : undefined;
}

function firstText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const message = record.message;
  if (message && typeof message === "object") {
    return firstText(message);
  }
  return undefined;
}

function llmOutput(result: LLMResult): unknown {
  const generations = result.generations;
  if (!Array.isArray(generations)) return result;
  const text = generations.flat().map(firstText).filter(Boolean).join("");
  return text || generations;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class LemmaLangChainCallbackHandler {
  name = "lemma";
  private lemma: Lemma | undefined;
  private readonly runs = new Map<RunId, StoredRun>();

  constructor(private readonly options: LangChainIntegrationOptions = {}) {
    this.lemma = options.lemma;
  }

  private getLemma() {
    this.lemma ??= new Lemma({
      apiKey: this.options.apiKey,
      projectId: this.options.projectId,
      baseUrl: this.options.baseUrl,
      fetch: this.options.fetch,
    });
    return this.lemma;
  }

  private traceName(serialized: Serialized | undefined, fallback: string) {
    return this.options.agentName ?? serializedName(serialized, fallback);
  }

  private startTrace(
    runId: RunId,
    serialized: Serialized | undefined,
    input: unknown,
    fallbackName: string,
    metadata?: Record<string, unknown>,
  ) {
    const trace = this.getLemma().trace({
      name: this.traceName(serialized, fallbackName),
      input: this.options.recordInputs === false ? undefined : input,
      metadata: {
        ...this.options.metadata,
        ...(metadata ?? {}),
        langchainRunId: runId,
      },
    });
    this.runs.set(runId, { trace, type: "chain" });
    return trace;
  }

  private parent(runId: RunId | undefined) {
    if (!runId) return undefined;
    return this.runs.get(runId);
  }

  handleChainStart(
    serialized: Serialized,
    inputs: unknown,
    runId: RunId,
    parentRunId?: RunId,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    _runType?: string,
    name?: string,
  ) {
    const parent = this.parent(parentRunId);
    if (!parent) {
      this.startTrace(
        runId,
        { ...serialized, name: name ?? serialized?.name },
        inputs,
        "langchain-run",
        metadata,
      );
      return;
    }
    const handle = (parent.handle ?? parent.trace)?.startSpan({
      name: name ?? serializedName(serialized, "langchain-chain"),
      input: this.options.recordInputs === false ? undefined : inputs,
      metadata: this.options.metadata,
      attributes: {
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": "chain",
      },
    });
    this.runs.set(runId, { handle, parentRunId, type: "chain" });
  }

  async handleChainEnd(outputs: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    if (run.trace) {
      await run.trace.end(
        this.options.recordOutputs === false ? undefined : { output: outputs },
      );
      this.runs.delete(runId);
      return;
    }
    run.handle?.end({
      output: this.options.recordOutputs === false ? undefined : outputs,
    });
    this.runs.delete(runId);
  }

  async handleChainError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    if (run.trace) {
      run.trace.fail(error);
      await run.trace.end();
      this.runs.delete(runId);
      return;
    }
    run.handle?.end({ status: "ERROR", error: errorMessage(error) });
    this.runs.delete(runId);
  }

  handleLLMStart(
    serialized: Serialized,
    prompts: string[],
    runId: RunId,
    parentRunId?: RunId,
    extraParams?: Record<string, unknown>,
  ) {
    const parent = this.parent(parentRunId);
    const trace =
      parent?.trace ??
      parent?.handle ??
      this.startTrace(runId, serialized, prompts, "langchain-llm");
    const handle = trace.startGeneration({
      name: serializedName(serialized, "langchain-llm"),
      input: this.options.recordInputs === false ? undefined : prompts,
      metadata: this.options.metadata,
      model: modelName(serialized),
      llmProvider: "langchain",
      llmInputMessages:
        this.options.recordInputs === false
          ? undefined
          : prompts.map((content) => ({ role: "user", content })),
      llmInvocationParameters: extraParams,
      attributes: {
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": "llm",
      },
    });
    this.runs.set(runId, { handle, parentRunId, type: "llm" });
  }

  handleChatModelStart(
    serialized: Serialized,
    messages: unknown[][],
    runId: RunId,
    parentRunId?: RunId,
    extraParams?: Record<string, unknown>,
  ) {
    const flatMessages = messages.flat();
    const parent = this.parent(parentRunId);
    const trace =
      parent?.trace ??
      parent?.handle ??
      this.startTrace(runId, serialized, flatMessages, "langchain-chat-model");
    const handle = trace.startGeneration({
      name: serializedName(serialized, "langchain-chat-model"),
      input: this.options.recordInputs === false ? undefined : flatMessages,
      metadata: this.options.metadata,
      model: modelName(serialized),
      llmProvider: "langchain",
      llmInputMessages:
        this.options.recordInputs === false ? undefined : flatMessages,
      llmInvocationParameters: extraParams,
      attributes: {
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": "llm",
      },
    });
    this.runs.set(runId, { handle, parentRunId, type: "llm" });
  }

  handleLLMEnd(output: LLMResult, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run?.handle) return;
    const outputText = llmOutput(output);
    run.handle.end({
      output: this.options.recordOutputs === false ? undefined : outputText,
      llmOutputMessages:
        this.options.recordOutputs === false || outputText === undefined
          ? undefined
          : [{ role: "assistant", content: outputText }],
    });
    this.runs.delete(runId);
  }

  handleLLMError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    run?.handle?.end({ status: "ERROR", error: errorMessage(error) });
    this.runs.delete(runId);
  }

  handleToolStart(
    serialized: Serialized,
    input: unknown,
    runId: RunId,
    parentRunId?: RunId,
  ) {
    const parent = this.parent(parentRunId);
    const trace =
      parent?.trace ??
      parent?.handle ??
      this.startTrace(runId, serialized, input, "langchain-tool");
    const name = serializedName(serialized, "langchain-tool");
    const handle = trace.startTool({
      name,
      toolName: name,
      input: this.options.recordInputs === false ? undefined : input,
      metadata: this.options.metadata,
      attributes: {
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": "tool",
      },
    });
    this.runs.set(runId, { handle, parentRunId, type: "tool" });
  }

  handleToolEnd(output: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    if (!run) return;
    const softError = toolResultError(output);
    if (softError) {
      run.handle?.end({
        status: "ERROR",
        error:
          this.options.recordOutputs === false ? undefined : softError,
      });
      this.runs.delete(runId);
      return;
    }
    run.handle?.end({
      output: this.options.recordOutputs === false ? undefined : output,
    });
    this.runs.delete(runId);
  }

  handleToolError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    run?.handle?.end({ status: "ERROR", error: errorMessage(error) });
    this.runs.delete(runId);
  }

  handleRetrieverStart(
    serialized: Serialized,
    query: string,
    runId: RunId,
    parentRunId?: RunId,
  ) {
    const parent = this.parent(parentRunId);
    const trace =
      parent?.trace ??
      parent?.handle ??
      this.startTrace(runId, serialized, query, "langchain-retriever");
    const handle = trace.startSpan({
      name: serializedName(serialized, "langchain-retriever"),
      input: this.options.recordInputs === false ? undefined : query,
      metadata: this.options.metadata,
      attributes: {
        "langchain.run_id": runId,
        "langchain.parent_run_id": parentRunId,
        "langchain.run_type": "retriever",
      },
    });
    this.runs.set(runId, { handle, parentRunId, type: "retriever" });
  }

  handleRetrieverEnd(documents: unknown[], runId: RunId) {
    const run = this.runs.get(runId);
    run?.handle?.end({
      output: this.options.recordOutputs === false ? undefined : documents,
    });
    this.runs.delete(runId);
  }

  handleRetrieverError(error: unknown, runId: RunId) {
    const run = this.runs.get(runId);
    run?.handle?.end({ status: "ERROR", error: errorMessage(error) });
    this.runs.delete(runId);
  }
}

export const LangChainCallbackHandler = LemmaLangChainCallbackHandler;

export function langChain(options: LangChainIntegrationOptions = {}) {
  return new LemmaLangChainCallbackHandler(options);
}

export function langGraph(options: LangChainIntegrationOptions = {}) {
  return langChain({ agentName: "langgraph-agent", ...options });
}

export type LemmaLangChainIntegrationOptions = LangChainIntegrationOptions;
export type LemmaLangGraphIntegrationOptions = LangChainIntegrationOptions;
