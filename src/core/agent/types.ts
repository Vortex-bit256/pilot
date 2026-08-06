import type { PermissionMode, ToolCall } from "../../protocol/index.js";

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  maxIterations: number;

  streaming: boolean;

  permissionMode: PermissionMode;
}


export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;

  toolCalls?: ToolCall[];

  toolCallId?: string;
}
