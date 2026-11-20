import { describeApiKey, type Fetch, type LemmaApiUrl } from "./api.js";
import {
  API_KEY_VARIABLE,
  PROJECT_ID_VARIABLE,
  type ExistingIngestKey,
} from "./env-file.js";
import type { ExistingMcpKey } from "./mcp/formats.js";

type KeyCheck = { verified: string | null; note?: string };

/**
 * The project the `.env` key is reported for: only when Lemma confirms an
 * ingest key limited to exactly `LEMMA_PROJECT_ID`, the key the server
 * would mint. Any other key, a project-limited admin key included, is
 * replaced with a new ingest key.
 */
export async function checkIngestKey(input: {
  existing: ExistingIngestKey;
  apiUrl: LemmaApiUrl;
  fetch: Fetch;
}): Promise<KeyCheck> {
  switch (input.existing.kind) {
    case "none":
      return { verified: null };
    case "unusable":
      return {
        verified: null,
        note: `.env: ${API_KEY_VARIABLE} has no usable ${PROJECT_ID_VARIABLE} to check it against. Setup replaces both after approval.`,
      };
    case "key": {
      const { apiKey, projectId } = input.existing;
      const key = await describeApiKey(input.apiUrl, apiKey, input.fetch);
      if (key?.scope === "ingest" && key.projectId === projectId) {
        return {
          verified: projectId,
          note: `.env: ${API_KEY_VARIABLE} is an ingest key limited to project ${projectId}. Setup keeps it if you approve that project.`,
        };
      }
      return {
        verified: null,
        note: `.env: Lemma did not confirm ${API_KEY_VARIABLE} as an ingest key limited to ${PROJECT_ID_VARIABLE}. Setup replaces both after approval.`,
      };
    }
  }
}

/**
 * The organization the coding agent's MCP key is reported for: only when
 * Lemma confirms an admin key that is not limited to one project, the key
 * the MCP server needs.
 */
export async function checkMcpKey(input: {
  existing: ExistingMcpKey;
  codingAgentName: string;
  apiUrl: LemmaApiUrl;
  fetch: Fetch;
}): Promise<KeyCheck> {
  const replaced = `MCP: Lemma did not confirm the key in ${input.codingAgentName}'s \`lemma\` server as an organization admin key. Setup replaces it after approval.`;
  switch (input.existing.kind) {
    case "none":
      return { verified: null };
    case "unusable":
      return { verified: null, note: replaced };
    case "key": {
      const key = await describeApiKey(
        input.apiUrl,
        input.existing.key,
        input.fetch,
      );
      if (key?.scope === "admin" && key.projectId === null) {
        return {
          verified: key.tenantId,
          note: `MCP: ${input.codingAgentName}'s \`lemma\` server has an admin key for organization ${key.tenantId}. Setup keeps it if you approve in that organization.`,
        };
      }
      return { verified: null, note: replaced };
    }
  }
}
