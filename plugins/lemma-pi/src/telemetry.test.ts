import type { TelemetrySpan } from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";

import { LEMMA_PI_CREDENTIALS_HELP } from "./credentials.js";
import { createLemmaPiTelemetryContext } from "./telemetry.js";

const credentials = {
  version: 1 as const,
  apiUrl: "https://dev.api.uselemma.ai",
  projectId: "10000000-0000-0000-0000-000000000001",
  credentialId: "credential-1",
  accessToken: "lemma_ci_scoped-secret",
};

describe("Pi telemetry exporter", () => {
  it("maps Pi run, generation, and tool spans to one SDK ingest payload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 201 }));
    let time = Date.parse("2026-08-21T01:00:00.000Z");
    let id = 0;
    const context = createLemmaPiTelemetryContext({
      credentials,
      fetch: fetchMock,
      now: () => new Date((time += 100)),
      createId: () =>
        `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    });

    await context.startSpan(
      {
        name: "pi.harness.run",
        attributes: {
          "pi.session.id": "session-1",
          "pi.operation.id": "operation-1",
          "pi.lane.name": "main",
          "pi.api_key": "must-not-leak",
        },
      },
      async (run: TelemetrySpan) => {
        await run.startSpan(
          {
            name: "pi.ai.request",
            attributes: {
              "pi.ai.operation": "stream",
              "pi.ai.provider": "anthropic",
              "pi.ai.model": "claude-sonnet-4",
              "pi.ai.api": "messages",
              "pi.ai.streaming": true,
            },
          },
          (generation) => {
            generation.setAttributes({
              "pi.ai.response.model": "claude-sonnet-4-20250514",
              "pi.ai.usage.input_tokens": 12,
              "pi.ai.usage.output_tokens": 7,
            });
          },
        );
        await run.startSpan(
          {
            name: "pi.harness.tool",
            attributes: {
              "pi.tool.name": "read",
              "pi.tool.call_id": "tool-1",
            },
          },
          () => undefined,
        );
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dev.api.uselemma.ai/traces/ingest",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/otel/v1/traces");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      project_id: string;
      trace: {
        name: string;
        thread_id?: string;
        metadata?: Record<string, unknown>;
        spans: Array<Record<string, unknown>>;
      };
    };
    expect(body.project_id).toBe(credentials.projectId);
    expect(body.trace).toMatchObject({
      name: "pi coding agent",
      thread_id: "session-1",
      metadata: {
        "lemma.harness.id": "pi",
        "lemma.harness.session_event_source": "telemetry-interface",
      },
    });
    expect(body.trace.spans).toEqual([
      expect.objectContaining({
        name: "pi model request",
        type: "generation",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
      expect.objectContaining({
        name: "read",
        type: "tool",
        tool_name: "read",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(JSON.stringify(body)).not.toContain(credentials.accessToken);
  });

  it("fails closed with rotation instructions when credentials are absent", () => {
    expect(() =>
      createLemmaPiTelemetryContext({
        dataDir: "/definitely/missing/lemma-pi",
      }),
    ).toThrow(LEMMA_PI_CREDENTIALS_HELP);
  });

  it("does not fail the Pi operation when delivery fails", async () => {
    const warnings: string[] = [];
    const context = createLemmaPiTelemetryContext({
      credentials,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("denied lemma_ci_scoped-secret", { status: 401 }),
        ),
      onDeliveryError: (message) => warnings.push(message),
    });
    await expect(
      context.startSpan({ name: "pi.harness.run" }, () => "completed"),
    ).resolves.toBe("completed");
    expect(warnings.join("\n")).toContain("rotate the scoped credential");
    expect(warnings.join("\n")).not.toContain(credentials.accessToken);
  });
});
