import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AGENT_NAME } from "./prompt";
import { loadExampleEnv } from "./env";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TurnIdentity = {
  threadId: string;
  userId?: string;
};

export type ChatTurn = {
  message: string;
  history: ChatMessage[];
  identity: TurnIdentity;
};

export type RunTurn = (turn: ChatTurn) => Promise<string>;

export function modelMessages(turn: ChatTurn): ChatMessage[] {
  return [...turn.history, { role: "user", content: turn.message }];
}

export function lemmaExampleMetadata(identity: TurnIdentity): {
  threadId: string;
  userId?: string;
} {
  return {
    threadId: identity.threadId,
    ...(identity.userId ? { userId: identity.userId } : {}),
  };
}

export function langChainMessagesFromTurn<T>(
  turn: ChatTurn,
  toMessage: (role: ChatMessage["role"], content: string) => T,
): T[] {
  return [
    ...turn.history.map((item) => toMessage(item.role, item.content)),
    toMessage("user", turn.message),
  ];
}

export function lastMessageText(
  messages: Array<{ content?: unknown }> | undefined,
): string {
  const last = messages?.at(-1);
  const content = last && "content" in last ? last.content : "";
  return typeof content === "string" ? content : JSON.stringify(content);
}

export async function runCli(runTurn: RunTurn): Promise<void> {
  loadExampleEnv();

  const identity: TurnIdentity = {
    threadId: randomUUID(),
    ...(process.env.LEMMA_USER_ID ? { userId: process.env.LEMMA_USER_ID } : {}),
  };
  const history: ChatMessage[] = [];

  const ask = async (message: string): Promise<string> => {
    const answer = await runTurn({ message, history, identity });
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: answer });
    return answer;
  };

  const oneShot = process.argv.slice(2).join(" ").trim();
  if (oneShot) {
    process.stdout.write(`${await ask(oneShot)}\n`);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  process.stdout.write(
    `${AGENT_NAME}  thread=${identity.threadId}\nAsk a question about Lemma. Empty line or Ctrl+D to exit.\n\n`,
  );
  try {
    while (true) {
      const line = await rl.question("> ");
      const message = line.trim();
      if (!message) break;
      const answer = await ask(message);
      process.stdout.write(`\n${answer}\n\n`);
    }
  } finally {
    rl.close();
  }
}
