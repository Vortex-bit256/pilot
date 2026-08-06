import OpenAI from "openai";
import type { TokenUsage, ToolCall } from "../../../protocol/index.js";
import type { Message } from "../../agent/types.js";
import type {
  ChatParams,
  LLMProvider,
  LLMResponse,
  ModelCapabilities,
} from "../provider.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export class DeepSeekProvider implements LLMProvider {
  readonly id = "deepseek";
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL = DEFAULT_BASE_URL) {

    this.client = new OpenAI({ apiKey, baseURL });
  }

  capabilities(model: string): ModelCapabilities {
    return {

      streaming: false,
      toolCalling: true,
      reasoning: model.includes("reasoner"),
    };
  }

  async chat(params: ChatParams): Promise<LLMResponse> {
    let response: OpenAI.ChatCompletion;

    try {
      response = await this.client.chat.completions.create({
        model: params.model,
        messages: toApiMessages(params),
        tools:
          params.tools?.length
            ? params.tools.map((t) => ({
                type: "function" as const,
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              }))
            : undefined,
      });
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(
          `DeepSeek API error (HTTP ${error.status ?? "unknown"}): ${error.message}`,
        );
      }
      throw error;
    }

    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: parseToolArguments(tc.function.arguments),
      }));

    const usage: TokenUsage | undefined = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    return {
      text: message?.content ?? undefined,
      toolCalls,
      stopReason: choice?.finish_reason ?? "unknown",
      usage,
    };
  }
}


export function createDeepSeekProvider(): DeepSeekProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set.\n" +
        "  1. Copy .env.example to .env and put your key there, or\n" +
        "  2. export DEEPSEEK_API_KEY=<your-key>",
    );
  }
  return new DeepSeekProvider(apiKey, process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL);
}


function toApiMessages(params: ChatParams): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }

  for (const m of params.messages) {
    if (m.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        content: m.content,
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  return messages;
}


function parseToolArguments(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
