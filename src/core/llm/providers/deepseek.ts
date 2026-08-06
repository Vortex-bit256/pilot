import OpenAI from "openai";
import type { TokenUsage, ToolCall } from "../../../protocol/index.js";
import type { Message } from "../../agent/types.js";
import type {
  ChatParams,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
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
      streaming: true,
      toolCalling: true,
      reasoning: model.includes("reasoner"),
    };
  }

  async chat(params: ChatParams): Promise<LLMResponse> {
    let response: OpenAI.ChatCompletion;

    try {
      response = await this.client.chat.completions.create(toApiRequest(params));
    } catch (error) {
      throw normalizeApiError(error);
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

    return {
      text: message?.content ?? undefined,
      toolCalls,
      stopReason: choice?.finish_reason ?? "unknown",
      usage: response.usage ? toTokenUsage(response.usage) : undefined,
    };
  }


  async *chatStream(params: ChatParams): AsyncGenerator<LLMStreamChunk, LLMResponse, void> {
    let text = "";
    let stopReason = "unknown";
    let usage: TokenUsage | undefined;
    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      const stream = await this.client.chat.completions.create({
        ...toApiRequest(params),
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta;

        if (delta?.content) {
          text += delta.content;
          yield { type: "text_delta", delta: delta.content };
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          const acc = pendingToolCalls.get(toolCall.index) ?? { id: "", name: "", arguments: "" };
          if (toolCall.id) acc.id = toolCall.id;
          if (toolCall.function?.name) acc.name += toolCall.function.name;
          if (toolCall.function?.arguments) acc.arguments += toolCall.function.arguments;
          pendingToolCalls.set(toolCall.index, acc);
        }

        if (choice?.finish_reason) {
          stopReason = choice.finish_reason;
        }
        if (chunk.usage) {
          usage = toTokenUsage(chunk.usage);
        }
      }
    } catch (error) {
      throw normalizeApiError(error);
    }

    const toolCalls: ToolCall[] = [...pendingToolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, tc]) => ({


        id: tc.id || `call_${index}`,
        name: tc.name,
        input: parseToolArguments(tc.arguments),
      }));

    return { text: text || undefined, toolCalls, stopReason, usage };
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


function toApiRequest(params: ChatParams) {
  return {
    model: params.model,
    messages: toApiMessages(params),
    tools: params.tools?.length
      ? params.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined,
  };
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

function toTokenUsage(usage: OpenAI.CompletionUsage): TokenUsage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}


function normalizeApiError(error: unknown): unknown {
  if (error instanceof OpenAI.APIError) {
    return new Error(
      `DeepSeek API error (HTTP ${error.status ?? "unknown"}): ${error.message}`,
    );
  }
  return error;
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
