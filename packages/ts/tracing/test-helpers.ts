import { vi } from "vitest";

export const LEMMA_PROJECT_ID = "10000000-0000-0000-0000-000000000001";

export function jsonBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

export function ingestFetchMock() {
  return vi.fn(async () => new Response("{}", { status: 201 }));
}
