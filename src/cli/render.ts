import type { Agent } from "../core/agent/agent.js";
import type { AgentEvent } from "../protocol/index.js";

export interface RenderOptions {

  debug: boolean;
}


export async function runAndRender(
  agent: Agent,
  task: string,
  options: RenderOptions,
): Promise<string> {
  const stream = agent.run(task);
  let step = await stream.next();
  while (!step.done) {
    renderEvent(step.value, options);
    step = await stream.next();
  }
  return step.value;
}


function renderEvent(event: AgentEvent, options: RenderOptions): void {
  if (options.debug) {
    console.error(`[debug] ${formatEvent(event)}`);
  }
}


function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case "text":
      return `text: "${truncate(event.text, 120)}"`;
    case "tool_call":
      return `-> tool call: ${event.call.name}(${JSON.stringify(event.call.input)})`;
    case "tool_result":
      return (
        `<- tool result: ${event.call.name}: ${event.result.isError ? "ERROR " : ""}` +
        `"${truncate(event.result.content)}"`
      );
    case "usage":
      return (
        `usage: prompt=${event.usage.promptTokens}, ` +
        `completion=${event.usage.completionTokens}, total=${event.usage.totalTokens}`
      );
    case "done":
      return `done (answer: ${event.answer.length} chars)`;
  }
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars total)` : text;
}
