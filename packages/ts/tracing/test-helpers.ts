import type { CallbackHandlerMethods } from "@langchain/core/callbacks/base";
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { ObservabilityExporter } from "@mastra/core/observability";
import type { Telemetry } from "ai";
import { vi } from "vitest";
import type { LemmaMastraExporter } from "./src/mastra";
import type { VercelAITelemetryIntegration } from "./src/vercel-ai";

export const LEMMA_PROJECT_ID = "10000000-0000-0000-0000-000000000001";

export function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

export function ingestFetchMock() {
  return vi.fn(async () => new Response("{}", { status: 201 }));
}

export function langChainCallbacks(handler: CallbackHandlerMethods): Callbacks {
  return [handler];
}

export function mastraExporters(
  exporter: LemmaMastraExporter,
): ObservabilityExporter[] {
  return [exporter as ObservabilityExporter];
}

export function vercelTelemetry(
  integration: VercelAITelemetryIntegration,
): Telemetry {
  return integration as Telemetry;
}
