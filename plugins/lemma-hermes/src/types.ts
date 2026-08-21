export type HermesToolEvent = {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  startedAt?: string;
  endedAt?: string;
};

export type HermesTurn = {
  version: 1;
  sessionId: string;
  turnId: string;
  prompt: string;
  response: string;
  startedAt: string;
  endedAt: string;
  generationStartedAt?: string;
  generationEndedAt?: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  tools: HermesToolEvent[];
};

export type PendingHermesTurn = {
  version: 1;
  apiUrl: string;
  projectId: string;
  turn: HermesTurn;
};
