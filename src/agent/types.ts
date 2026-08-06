import type { ToolDefinition } from "../tools/types.js";

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  maxIterations: number;

  debug?: boolean;
}


export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;

  toolCalls?: ToolCall[];

  toolCallId?: string;
}
