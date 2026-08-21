export type OpenClawToolCall = {
  toolUseId: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  startedAt?: string;
  endedAt?: string;
};

export type OpenClawTurn = {
  version: 1;
  sessionId: string;
  turnId: string;
  prompt: string;
  response: string;
  startedAt: string;
  endedAt: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  tools: OpenClawToolCall[];
};

export type PendingOpenClawTurn = {
  version: 1;
  apiUrl: string;
  projectId: string;
  turn: OpenClawTurn;
};
