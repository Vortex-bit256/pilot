import type { ToolCall } from "../../protocol/index.js";

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  maxIterations: number;

  streaming: boolean;
}


export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;

  toolCalls?: ToolCall[];

  toolCallId?: string;
}
