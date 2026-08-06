import type { LLMProvider } from "../llm/provider.js";
import { executeTool } from "../tools/index.js";
import type { AgentConfig, Message } from "./types.js";


function debugLog(enabled: boolean | undefined, message: string): void {
  if (enabled) {
    console.error(`[debug] ${message}`);
  }
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars total)` : text;
}

export class Agent {
  private readonly messages: Message[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly llm: LLMProvider,
  ) {}

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: "user", content: userInput });

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      debugLog(this.config.debug, `iteration ${iteration + 1}/${this.config.maxIterations}, messages: ${this.messages.length}`);

      const response = await this.llm.chat({
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        messages: this.messages,
        tools: this.config.tools,
      });

      this.messages.push({
        role: "assistant",
        content: response.text ?? "",
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      debugLog(
        this.config.debug,
        `LLM response: stopReason=${response.stopReason}, toolCalls=${response.toolCalls.length}` +
          (response.text ? `, text="${truncate(response.text, 120)}"` : ""),
      );


      if (response.toolCalls.length === 0) {
        return response.text ?? "";
      }


      for (const call of response.toolCalls) {
        debugLog(this.config.debug, `-> tool call: ${call.name}(${JSON.stringify(call.input)})`);

        const result = await executeTool(call.name, call.input);

        debugLog(
          this.config.debug,
          `<- tool result: ${call.name}: ${result.isError ? "ERROR " : ""}"${truncate(result.content)}"`,
        );

        this.messages.push({
          role: "tool",
          toolCallId: call.id,
          content: result.isError ? `Error: ${result.content}` : result.content,
        });
      }
    }

    return `Stopped: reached the limit of ${this.config.maxIterations} iterations without a final answer.`;
  }
}
