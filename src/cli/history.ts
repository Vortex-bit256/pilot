import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Message } from "../core/agent/types.js";

const MAX_CHATS = 30;
const MAX_MESSAGES_PER_CHAT = 200;

export interface CliChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

export interface CliHistory {
  activeChatId: string;
  chats: CliChat[];
}

export function createChat(title = "New chat"): CliChat {
  const now = Date.now();
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    updatedAt: now,
    messages: [],
  };
}

export function defaultHistory(): CliHistory {
  const chat = createChat();
  return {
    activeChatId: chat.id,
    chats: [chat],
  };
}

export async function loadHistory(path = historyPath()): Promise<CliHistory> {
  try {
    const raw = await readFile(path, "utf8");
    return normalizeHistory(JSON.parse(raw));
  } catch {
    return defaultHistory();
  }
}

export async function saveHistory(history: CliHistory, path = historyPath()): Promise<void> {
  const normalized = normalizeHistory(history);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function activeChat(history: CliHistory): CliChat {
  return history.chats.find((chat) => chat.id === history.activeChatId) ?? history.chats[0];
}

export function updateActiveChat(
  history: CliHistory,
  messages: Message[],
  titleFrom?: string,
): void {
  const chat = activeChat(history);
  chat.messages = messages.slice(-MAX_MESSAGES_PER_CHAT);
  chat.updatedAt = Date.now();
  if (titleFrom && chat.title === "New chat") {
    chat.title = summarizeTitle(titleFrom);
  }
  history.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  history.chats = history.chats.slice(0, MAX_CHATS);
}

export function historyPath(): string {
  return process.env.PILOT_HISTORY_PATH ?? join(homedir(), ".pilot", "history.json");
}

function normalizeHistory(value: unknown): CliHistory {
  if (!isRecord(value) || !Array.isArray(value.chats)) {
    return defaultHistory();
  }

  const chats = value.chats
    .filter(isRecord)
    .map((chat) => ({
      id: typeof chat.id === "string" ? chat.id : createChat().id,
      title: typeof chat.title === "string" && chat.title.trim() ? chat.title : "New chat",
      updatedAt: typeof chat.updatedAt === "number" ? chat.updatedAt : Date.now(),
      messages: Array.isArray(chat.messages) ? chat.messages.filter(isMessage) : [],
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);

  if (chats.length === 0) {
    return defaultHistory();
  }

  const activeChatId =
    typeof value.activeChatId === "string" && chats.some((chat) => chat.id === value.activeChatId)
      ? value.activeChatId
      : chats[0].id;

  return { activeChatId, chats };
}

function isMessage(value: unknown): value is Message {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant" || value.role === "tool") &&
    typeof value.content === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 48 ? `${flat.slice(0, 48)}...` : flat || "New chat";
}
