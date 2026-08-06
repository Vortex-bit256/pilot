


import assert from "node:assert/strict";
import { z } from "zod";
import { Agent } from "../src/core/agent/agent.js";
import type { Message } from "../src/core/agent/types.js";
import type {
  ChatParams,
  LLMProvider,
  LLMResponse,
  ModelCapabilities,
} from "../src/core/llm/provider.js";
import { defineTool, type AnyTool } from "../src/core/tools/tool.js";
import { ToolRegistry } from "../src/core/tools/registry.js";
import type {
  AgentEvent,
  PermissionMode,
  ToolCall,
  ToolKind,
} from "../src/protocol/index.js";


export class FakeProvider implements LLMProvider {
  readonly id = "fake";
  readonly calls: ChatParams[] = [];
  private readonly script: LLMResponse[];

  constructor(script: LLMResponse[]) {
    this.script = [...script];
  }

  capabilities(): ModelCapabilities {
    return { streaming: false, toolCalling: true, reasoning: false };
  }

  async chat(params: ChatParams): Promise<LLMResponse> {


    this.calls.push({ ...params, messages: [...params.messages] });
    const next = this.script.shift();
    if (!next) {
      throw new Error("FakeProvider script exhausted");
    }
    return next;
  }
}


export function spyTool(
  name: string,
  kind: ToolKind,
  counter: { count: number },
  onExecute?: () => void,
): AnyTool {
  return defineTool({
    name,
    description: `stub ${kind} tool for tests`,
    kind,
    schema: z.object({}),
    async execute() {
      counter.count++;
      onExecute?.();
      return { content: `${name} executed` };
    },
  });
}


export function scriptFor(...calls: ToolCall[]): LLMResponse[] {
  return [
    { toolCalls: calls, stopReason: "tool_calls" },
    { text: "final answer", toolCalls: [], stopReason: "stop" },
  ];
}

export function makeAgent(mode: PermissionMode, provider: LLMProvider, tools: AnyTool[]): Agent {
  const registry = new ToolRegistry();
  registry.registerAll(tools);
  return new Agent(
    {
      model: "fake-model",
      systemPrompt: "",
      maxIterations: 5,
      streaming: false,
      permissionMode: mode,
    },
    provider,
    registry,
    { cwd: process.cwd() },
  );
}


export async function runToEnd(
  agent: Agent,
  task: string,
  signal?: AbortSignal,
): Promise<{ events: AgentEvent[]; answer: string }> {
  const events: AgentEvent[] = [];
  const stream = agent.run(task, { signal });
  let step = await stream.next();
  while (!step.done) {
    events.push(step.value);
    step = await stream.next();
  }
  return { events, answer: step.value };
}


export function lastMessage(provider: FakeProvider): Message {
  const message = provider.calls.at(-1)?.messages.at(-1);
  assert.ok(message, "expected the provider to be called with messages");
  return message;
}
