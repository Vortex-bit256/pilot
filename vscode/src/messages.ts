import type {
  ApprovalDecision,
  PermissionMode,
  TokenUsage,
  ToolCall,
  ToolKind,
  ToolProgress,
  ToolResult,
} from "../../src/protocol/index.js";

import type { DiffLine } from "../../src/cli/diff.js";
import type { Message } from "../../src/core/agent/types.js";


export type ChatEntry =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; call: ToolCall; result?: ToolResult }
  | { type: "footer"; stats: { elapsed: string; usage?: TokenUsage } }
  | { type: "error"; text: string };


export interface ChatHistoryItem {
  id: string;
  title: string;
  updatedAt: number;
  entries: ChatEntry[];
  agentMessages: Message[];
}


export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
}


export type ToWebviewMessage =
  | { type: "assistantDelta"; delta: string }
  | { type: "assistantText"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "toolProgress"; call: ToolCall; progress: ToolProgress }
  | { type: "toolResult"; call: ToolCall; result: ToolResult }

  | {
      type: "approvalRequest";
      id: string;
      call: ToolCall;
      kind: ToolKind;
      preview?: ApprovalPreview;
    }
  | { type: "approvalResolved"; id: string; decision: ApprovalDecision }
  | {
      type: "runFinished";
      error?: string;
      stats?: { elapsed: string; usage?: TokenUsage };
    }
  | { type: "status"; running: boolean; mode: PermissionMode }
  | { type: "reset" }
  | { type: "historyState"; chats: ChatSummary[]; activeChatId: string; entries: ChatEntry[] };


export type ApprovalPreview =
  | { kind: "diff"; path: string; lines: DiffLine[] }
  | { kind: "new-file"; path: string; content: string }
  | { kind: "command"; command: string }
  | { kind: "raw"; json: string };


export type FromWebviewMessage =
  | { type: "runTask"; text: string }
  | { type: "cancel" }
  | { type: "approval"; id: string; decision: ApprovalDecision }
  | { type: "setMode"; mode: PermissionMode }
  | { type: "newSession" }
  | { type: "selectChat"; id: string }
  | { type: "deleteChat"; id: string }
  | { type: "ready" };
