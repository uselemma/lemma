import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { Observability } from "@mastra/observability";
import { LemmaMastraExporter } from "@uselemma/tracing";

export const mastra = new Mastra({
  agents: {
    supportAgent: new Agent({
      name: "support-agent",
      instructions: "Answer customer questions clearly and concisely.",
      model: "openai/gpt-4o",
    }),
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: "support-app",
        exporters: [new LemmaMastraExporter()],
      },
    },
  }),
});

const agent = mastra.getAgent("supportAgent");
const result = await agent.generate("Where is my order?");

console.log(result.text);
