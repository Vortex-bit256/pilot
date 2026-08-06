import type { AgentEvent } from "../../protocol/index.js";
import type { ChatParams, LLMProvider, LLMResponse } from "../llm/provider.js";
import type { ToolContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentConfig, Message } from "./types.js";


interface LLMCallResult {
  response: LLMResponse;

  streamed: boolean;
}


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
      const { response, streamed } = yield* this.chat({
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


      if (response.text && !streamed) {
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
