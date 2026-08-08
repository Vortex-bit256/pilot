import type {
  AgentEvent,
  ApprovalDecision,
  PermissionMode,
  ToolCall,
  ToolProgress,
  ToolResult,
} from "../../protocol/index.js";

import type { ChatParams, LLMProvider, LLMResponse } from "../llm/provider.js";
import type { ToolContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import { needsApproval, type ApprovalHandler } from "./permissions.js";
import type { AgentConfig, Message } from "./types.js";


interface LLMCallResult {
  response: LLMResponse;

  streamed: boolean;
}


export const CANCELLED_ANSWER = "Cancelled by user.";


export class Agent {
  private readonly messages: Message[];
  private approvalHandler?: ApprovalHandler;

  private readonly sessionAllowlist = new Set<string>();

  constructor(
    private readonly config: AgentConfig,
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly toolContext: ToolContext,
    initialMessages: Message[] = [],
  ) {
    this.messages = initialMessages.map((message) => ({ ...message }));
  }


  get permissionMode(): PermissionMode {
    return this.config.permissionMode;
  }


  setPermissionMode(mode: PermissionMode): void {
    this.config.permissionMode = mode;
  }


  setApprovalHandler(handler: ApprovalHandler | undefined): void {
    this.approvalHandler = handler;
  }


  snapshotMessages(): Message[] {
    return this.messages.map((message) => ({ ...message }));
  }


  replaceMessages(messages: Message[]): void {
    this.messages.splice(0, this.messages.length, ...messages.map((message) => ({ ...message })));
  }


  async *run(
    userInput: string,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentEvent, string, void> {
    const { signal } = options;
    const toolContext: ToolContext = { ...this.toolContext, signal };
    this.messages.push({ role: "user", content: userInput });

    try {
      for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
        if (signal?.aborted) {
          return yield* this.cancelTask();
        }

        const { response, streamed } = yield* this.chat({
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          messages: this.messages,
          tools: this.tools.definitions(),
          signal,
        });

        if (response.usage) {
          yield { type: "usage", usage: response.usage };
        }

        this.messages.push({
          role: "assistant",
          content: response.text ?? "",
          toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
        });


        if (response.text && !streamed) {
          yield { type: "text", text: response.text };
        }


        if (response.toolCalls.length === 0) {
          const answer = response.text ?? "";
          yield { type: "done", answer };
          return answer;
        }


        for (const call of response.toolCalls) {
          if (signal?.aborted) {
            return yield* this.cancelTask();
          }

          yield { type: "tool_call", call };

          const result = yield* this.executeWithProgress(call, toolContext);


          if (signal?.aborted) {
            return yield* this.cancelTask();
          }

          yield { type: "tool_result", call, result };


          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: result.isError ? `Error: ${result.content}` : result.content,
          });
        }
      }
    } catch (error) {

      if (signal?.aborted) {
        return yield* this.cancelTask();
      }
      throw error;
    }

    const answer = `Stopped: reached the limit of ${this.config.maxIterations} iterations without a final answer.`;
    yield { type: "done", answer };
    return answer;
  }


  private *cancelTask(): Generator<AgentEvent, string, void> {
    this.settlePendingToolCalls();
    yield { type: "cancelled" };
    return CANCELLED_ANSWER;
  }


  private settlePendingToolCalls(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.role !== "assistant" || !message.toolCalls?.length) {
        continue;
      }
      const answered = new Set(
        this.messages
          .slice(i + 1)
          .filter((m) => m.role === "tool")
          .map((m) => m.toolCallId),
      );
      for (const call of message.toolCalls) {
        if (!answered.has(call.id)) {
          this.messages.push({
            role: "tool",
            toolCallId: call.id,
            content: "Error: task was cancelled by the user before this tool ran.",
          });
        }
      }
      return;
    }
  }


  private async executeWithApproval(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(call.name);

    if (!entry) {
      return this.tools.execute(call, ctx);
    }

    const kind = entry.tool.definition.kind;
    const mode = this.config.permissionMode;

    if (needsApproval(mode, kind) && !this.sessionAllowlist.has(call.name)) {
      if (!this.approvalHandler) {
        return {
          content:
            `Tool "${call.name}" (kind: ${kind}) requires user approval in "${mode}" mode, ` +
            "but this session has no approval channel (non-interactive). The call was denied " +
            "automatically. Explain what you wanted to do and let the user decide how to proceed.",
          isError: true,
        };
      }

      let decision: ApprovalDecision;
      try {
        decision = await this.approvalHandler({ call, kind, signal: ctx.signal });
      } catch (error) {


        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Approval for tool "${call.name}" failed (${message}); the call was denied. Try again or ask the user for guidance.`,
          isError: true,
        };
      }

      if (decision === "deny") {
        return {
          content:
            "The user denied this tool call. Do not retry it unchanged; " +
            "ask the user how to proceed or propose a different approach.",
          isError: true,
        };
      }

      if (decision === "always") {
        this.sessionAllowlist.add(call.name);
      }
    }

    return this.tools.execute(call, ctx);
  }


  private async *executeWithProgress(
    call: ToolCall,
    ctx: ToolContext,
  ): AsyncGenerator<AgentEvent, ToolResult, void> {
    const pending: ToolProgress[] = [];
    const execution = this.executeWithApproval(call, {
      ...ctx,
      onProgress: (progress) => pending.push(progress),
    });

    let result: ToolResult;
    try {


      while (true) {
        const outcome = await Promise.race([
          execution.then(
            (r) => ({ kind: "done" as const, result: r }),
            (error: unknown) => ({ kind: "failed" as const, error }),
          ),
          new Promise<{ kind: "tick" }>((resolve) =>
            setTimeout(() => resolve({ kind: "tick" }), 50),
          ),
        ]);

        let progress: ToolProgress | undefined;
        while ((progress = pending.shift())) {
          yield { type: "tool_progress", call, progress };
        }

        if (outcome.kind === "done") {
          result = outcome.result;
          break;
        }
        if (outcome.kind === "failed") {
          throw outcome.error;
        }
      }
    } finally {

      execution.catch(() => {});
    }
    return result;
  }


  private async *chat(params: ChatParams): AsyncGenerator<AgentEvent, LLMCallResult, void> {
    const chatStream =
      this.config.streaming && this.llm.capabilities(params.model).streaming
        ? this.llm.chatStream
        : undefined;

    if (!chatStream) {
      return { response: await this.llm.chat(params), streamed: false };
    }

    const stream = chatStream.call(this.llm, params);
    let step = await stream.next();
    while (!step.done) {
      yield { type: "text_delta", delta: step.value.delta };
      step = await stream.next();
    }
    return { response: step.value, streamed: true };
  }
}
