import type { Message, ToolCall } from "../agent/types.js";
import type { ToolDefinition } from "../tools/types.js";

export type { ToolCall } from "../agent/types.js";

export interface ChatParams {
  model: string;
  systemPrompt?: string;
  messages: Message[];
  tools?: ToolDefinition[];
}

export interface LLMResponse {
  text?: string;
  toolCalls: ToolCall[];
  stopReason: string;
}

export interface LLMProvider {
  chat(params: ChatParams): Promise<LLMResponse>;
}
