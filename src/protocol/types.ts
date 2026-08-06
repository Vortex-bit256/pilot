


export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}


export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
