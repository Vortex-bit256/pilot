import type { AgentEvent } from "../../protocol/index.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ToolContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentConfig, Message } from "./types.js";


export class Agent {
  private readonly messages: Message[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly llm: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly toolContext: ToolContext,
  ) {}


  async *run(userInput: string): AsyncGenerator<AgentEvent, string, void> {
    this.messages.push({ role: "user", content: userInput });

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      const response = await this.llm.chat({
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        messages: this.messages,
        tools: this.tools.definitions(),
      });

      if (response.usage) {
        yield { type: "usage", usage: response.usage };
      }

      this.messages.push({
        role: "assistant",
        content: response.text ?? "",
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.text) {
        yield { type: "text", text: response.text };
      }


      if (response.toolCalls.length === 0) {
        const answer = response.text ?? "";
        yield { type: "done", answer };
        return answer;
      }


      for (const call of response.toolCalls) {
        yield { type: "tool_call", call };

        const result = await this.tools.execute(call, this.toolContext);

        yield { type: "tool_result", call, result };

        this.messages.push({
          role: "tool",
          toolCallId: call.id,
          content: result.isError ? `Error: ${result.content}` : result.content,
        });
      }
    }

    const answer = `Stopped: reached the limit of ${this.config.maxIterations} iterations without a final answer.`;
    yield { type: "done", answer };
    return answer;
  }
}
