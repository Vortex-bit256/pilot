import type { TokenUsage, ToolCall, ToolResult } from "./types.js";


export type AgentEvent =

  | { type: "text"; text: string }

  | { type: "tool_call"; call: ToolCall }

  | { type: "tool_result"; call: ToolCall; result: ToolResult }

  | { type: "usage"; usage: TokenUsage }

  | { type: "done"; answer: string };
