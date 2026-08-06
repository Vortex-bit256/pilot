


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


export type ToolKind = "read" | "write" | "exec";


export type PermissionMode = "safe" | "work" | "free";


export interface ApprovalRequest {
  call: ToolCall;
  kind: ToolKind;
}


export type ApprovalDecision = "allow" | "deny";

