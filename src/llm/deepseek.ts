import OpenAI from "openai";
import type { Message, ToolCall } from "../agent/types.js";
import type { ChatParams, LLMProvider, LLMResponse } from "./provider.js";

export class DeepSeekProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL = "https://api.deepseek.com") {

    this.client = new OpenAI({ apiKey, baseURL });
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

    return {
      text: message?.content ?? undefined,
      toolCalls,
      stopReason: choice?.finish_reason ?? "unknown",
    };
  }
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
