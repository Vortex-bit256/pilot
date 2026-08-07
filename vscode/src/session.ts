import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as vscode from "vscode";
import { Agent } from "../../src/core/agent/agent.js";
import type { ApprovalHandler } from "../../src/core/agent/permissions.js";
import { registerBuiltinProviders } from "../../src/core/llm/providers/index.js";
import { createProvider } from "../../src/core/llm/registry.js";
import { builtinTools } from "../../src/core/tools/builtin/index.js";
import { ToolRegistry } from "../../src/core/tools/registry.js";
import { diffLines, type DiffLine } from "../../src/cli/diff.js";
import type {
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
  TokenUsage,
  ToolCall,
} from "../../src/protocol/index.js";
import type { ToWebviewMessage } from "./messages.js";

const SYSTEM_PROMPT = `You are a coding agent running inside VS Code.
You help the user with programming tasks in the current workspace folder.
Use the available tools to inspect the project (list_files, read_file), modify it
(write_file, edit_file) and verify your changes (run_command).
Prefer edit_file for small changes to existing files and write_file for new files.
Explain briefly what you are doing and keep answers concise.`;

const PERMISSION_MODES: PermissionMode[] = ["safe", "work", "free"];


export class AgentSession implements vscode.Disposable {
  private agent: Agent;
  private readonly cwd: string;
  private readonly debug: boolean;
  private currentTask: AbortController | undefined;
  private pendingApproval:
    | { id: string; resolve: (decision: ApprovalDecision) => void }
    | undefined;
  private readonly log: vscode.OutputChannel;

  constructor(
    private readonly post: (message: ToWebviewMessage) => void,
    workspaceRoot: string,
    private readonly extensionPath: string,
  ) {
    this.cwd = workspaceRoot;
    this.log = vscode.window.createOutputChannel("Simple Agent");


    const settings = vscode.workspace.getConfiguration("simple-agent");
    const providerId = settings.get<string>("provider", "deepseek");
    const model = settings.get<string>("model", "deepseek-chat");
    const permissionMode = settings.get<PermissionMode>("permissionMode", "safe");
    this.debug = settings.get<boolean>("debug", false);

    this.loadDotEnv();

    registerBuiltinProviders();
    const llm = createProvider(providerId);

    const tools = new ToolRegistry();
    tools.registerAll(builtinTools);

    this.agent = new Agent(
      {
        model,
        systemPrompt: SYSTEM_PROMPT,
        maxIterations: settings.get<number>("maxIterations", 20),
        streaming: settings.get<boolean>("streaming", true),
        permissionMode,
      },
      llm,
      tools,
      { cwd: this.cwd },
    );

    this.agent.setApprovalHandler(this.handleApproval);
    this.postStatus();
  }

  get running(): boolean {
    return this.currentTask !== undefined && !this.currentTask.signal.aborted;
  }

  get permissionMode(): PermissionMode {
    return this.agent.permissionMode;
  }


  cycleMode(): void {
    const index = PERMISSION_MODES.indexOf(this.agent.permissionMode);
    this.setMode(PERMISSION_MODES[(index + 1) % PERMISSION_MODES.length]);
  }

  setMode(mode: PermissionMode): void {
    this.agent.setPermissionMode(mode);
    this.postStatus();
    if (mode === "free") {
      vscode.window.showWarningMessage(
        "Simple Agent: FREE MODE — all tool calls, including shell commands, run WITHOUT confirmation.",
      );
    }
  }


  async runTask(text: string): Promise<void> {
    if (this.running) {
      vscode.window.showInformationMessage("Simple Agent: a task is already running.");
      return;
    }

    const controller = new AbortController();
    this.currentTask = controller;
    this.postStatus();

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let sawUsage = false;
    const startedAt = Date.now();

    try {
      const stream = this.agent.run(text, { signal: controller.signal });
      let step = await stream.next();
      while (!step.done) {
        const event = step.value;
        this.debugLog(event);
        this.forwardEvent(event);

        if (event.type === "usage") {
          usage.promptTokens += event.usage.promptTokens;
          usage.completionTokens += event.usage.completionTokens;
          usage.totalTokens += event.usage.totalTokens;
          sawUsage = true;
        }
        step = await stream.next();
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.post({
        type: "runFinished",
        stats: { elapsed, usage: sawUsage ? usage : undefined },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: "runFinished", error: message });
    } finally {

      this.settleApproval("deny");
      this.currentTask = undefined;
      this.postStatus();
    }
  }


  cancelTask(): void {
    if (this.currentTask && !this.currentTask.signal.aborted) {
      this.currentTask.abort();
    }
  }


  resolveApproval(id: string, decision: ApprovalDecision): void {
    if (this.pendingApproval?.id === id) {
      const pending = this.pendingApproval;
      this.pendingApproval = undefined;
      this.post({ type: "approvalResolved", id, decision });
      pending.resolve(decision);
    }
  }

  private settleApproval(decision: ApprovalDecision): void {
    const pending = this.pendingApproval;
    if (pending) {
      this.pendingApproval = undefined;
      this.post({ type: "approvalResolved", id: pending.id, decision });
      pending.resolve(decision);
    }
  }


  private handleApproval: ApprovalHandler = (request: ApprovalRequest) => {
    return new Promise<ApprovalDecision>((resolvePromise) => {
      const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;


      request.signal?.addEventListener("abort", () => this.settleApproval("deny"), {
        once: true,
      });

      this.pendingApproval = { id, resolve: resolvePromise };

      void this.buildPreview(request.call).then((preview) => {

        if (this.pendingApproval?.id !== id) {
          return;
        }
        this.post({
          type: "approvalRequest",
          id,
          call: request.call,
          kind: request.kind,
          preview,
        });
      });
    });
  };


  private async buildPreview(call: ToolCall): Promise<
    | { kind: "diff"; path: string; lines: DiffLine[] }
    | { kind: "new-file"; path: string; content: string }
    | { kind: "command"; command: string }
    | { kind: "raw"; json: string }
    | undefined
  > {
    const str = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;

    try {
      if (call.name === "write_file") {
        const path = str(call.input.path);
        const content = str(call.input.content);
        if (path === undefined || content === undefined) {
          return { kind: "raw", json: JSON.stringify(call.input, null, 2) };
        }
        let existing: string | undefined;
        try {
          existing = await readFile(resolve(this.cwd, path), "utf8");
        } catch {
          existing = undefined;
        }
        if (existing === undefined) {
          return { kind: "new-file", path, content };
        }
        if (existing === content) {
          return { kind: "raw", json: `${path}: content identical to the current file` };
        }
        return { kind: "diff", path, lines: diffLines(existing, content) };
      }

      if (call.name === "edit_file") {
        const path = str(call.input.path);
        const oldString = str(call.input.old_string);
        const newString = str(call.input.new_string);
        if (path === undefined || oldString === undefined || newString === undefined) {
          return { kind: "raw", json: JSON.stringify(call.input, null, 2) };
        }
        const content = await readFile(resolve(this.cwd, path), "utf8");
        if (content.split(oldString).length - 1 !== 1) {
          return {
            kind: "raw",
            json: `${path}: cannot preview (old_string is not unique, the tool will reject this)`,
          };
        }
        return { kind: "diff", path, lines: diffLines(content, content.replace(oldString, newString)) };
      }

      if (call.name === "run_command") {
        const command = str(call.input.command);
        if (command !== undefined) {
          return { kind: "command", command };
        }
      }

      return { kind: "raw", json: JSON.stringify(call.input, null, 2) };
    } catch {
      return undefined;
    }
  }


  private forwardEvent(event: AgentEvent): void {
    switch (event.type) {
      case "text":
        this.post({ type: "assistantText", text: event.text });
        break;
      case "text_delta":
        this.post({ type: "assistantDelta", delta: event.delta });
        break;
      case "tool_call":
        this.post({ type: "toolCall", call: event.call });
        break;
      case "tool_progress":
        this.post({ type: "toolProgress", call: event.call, progress: event.progress });
        break;
      case "tool_result":
        this.post({ type: "toolResult", call: event.call, result: event.result });
        break;
      case "done":
      case "cancelled":
      case "usage":

        break;

    }
  }

  private postStatus(): void {
    this.post({
      type: "status",
      running: this.running,
      mode: this.agent.permissionMode,
    });
  }


  private loadDotEnv(): void {
    for (const envPath of [
      join(this.cwd, ".env"),
      join(this.extensionPath, "..", ".env"),
    ]) {
      if (existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }
    }
  }

  private debugLog(event: AgentEvent): void {
    if (!this.debug) {
      return;
    }
    const summary =
      event.type === "text"
        ? `text (${event.text.length} chars)`
        : event.type === "text_delta"
          ? `text_delta ${JSON.stringify(event.delta)}`
          : event.type === "tool_call"
            ? `tool_call ${event.call.name}`
            : event.type === "tool_result"
              ? `tool_result ${event.call.name}${event.result.isError ? " ERROR" : ""}`
              : event.type;
    this.log.appendLine(`[event] ${summary}`);
  }

  dispose(): void {
    this.cancelTask();
    this.settleApproval("deny");
    this.log.dispose();
  }
}
