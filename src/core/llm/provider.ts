import type { TokenUsage, ToolCall } from "../../protocol/index.js";
import type { Message } from "../agent/types.js";
import type { ToolDefinition } from "../tools/tool.js";

export interface ChatParams {
  model: string;
  systemPrompt?: string;
  messages: Message[];
  tools?: ToolDefinition[];


  signal?: AbortSignal;
}


export interface LLMResponse {
  text?: string;
  toolCalls: ToolCall[];
  stopReason: string;
  usage?: TokenUsage;
}


export type LLMStreamChunk = { type: "text_delta"; delta: string };


export interface ModelCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  maxContextTokens?: number;
}


export interface LLMProvider {
  readonly id: string;
  capabilities(model: string): ModelCapabilities;
  chat(params: ChatParams): Promise<LLMResponse>;


  chatStream?(params: ChatParams): AsyncGenerator<LLMStreamChunk, LLMResponse, void>;
}
