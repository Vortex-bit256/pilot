import type {
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
  ToolKind,
} from "../../protocol/index.js";


export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export const PERMISSION_MODES: readonly PermissionMode[] = ["safe", "work", "free"];


export function parsePermissionMode(raw: string): PermissionMode | undefined {
  const normalized = raw.trim().toLowerCase();
  return (PERMISSION_MODES as readonly string[]).includes(normalized)
    ? (normalized as PermissionMode)
    : undefined;
}


const ASK_MATRIX: Record<PermissionMode, ReadonlySet<ToolKind>> = {
  safe: new Set<ToolKind>(["write", "exec"]),
  work: new Set<ToolKind>(["exec"]),
  free: new Set<ToolKind>(),
};


export function needsApproval(mode: PermissionMode, kind: ToolKind): boolean {
  return ASK_MATRIX[mode].has(kind);
}


export function describePermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case "safe":
      return "safe (approve writes and commands)";
    case "work":
      return "work (approve commands only)";
    case "free":
      return "free (auto-approve EVERYTHING — not recommended)";
  }
}
