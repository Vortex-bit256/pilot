import type { Agent } from "../core/agent/agent.js";
import type { AgentEvent } from "../protocol/index.js";
import { cyan, dim, green, isTTY, red } from "./ansi.js";


export interface RenderOptions {

  debug: boolean;
}


export async function runAndRender(
  agent: Agent,
  task: string,
  options: RenderOptions,
): Promise<string> {
  const renderer: Renderer = options.debug ? new DebugRenderer() : new LiveRenderer();
  renderer.start();
  const stream = agent.run(task);
  try {
    let step = await stream.next();
    while (!step.done) {
      renderer.handle(step.value);
      step = await stream.next();
    }
    return step.value;
  } finally {
    renderer.finish();
  }
}

interface Renderer {
  start(): void;
  handle(event: AgentEvent): void;
  finish(): void;
}


class LiveRenderer implements Renderer {
  private textOpen = false;
  private sawText = false;
  private thinkingShown = false;

  start(): void {
    if (isTTY) {
      process.stdout.write(dim("thinking…"));
      this.thinkingShown = true;
    }
  }

  handle(event: AgentEvent): void {
    switch (event.type) {
      case "text_delta":
        this.beforeOutput();
        process.stdout.write(event.delta);
        this.textOpen = true;
        this.sawText = true;
        break;
      case "text":
        this.beforeOutput();
        process.stdout.write(event.text);
        this.textOpen = true;
        this.sawText = true;
        break;
      case "tool_call":
        this.beforeOutput();
        this.closeText();
        console.log(cyan(`→ ${event.call.name} ${summarizeInput(event.call.input)}`));
        break;
      case "tool_result":
        this.beforeOutput();
        this.closeText();
        if (event.result.isError) {
          console.log(
            red(`← ${event.call.name} error: ${truncate(firstLine(event.result.content), 160)}`),
          );
        } else {
          console.log(
            green(`← ${event.call.name} ok`) + dim(` (${formatChars(event.result.content.length)})`),
          );
        }
        break;
      case "usage":
        this.beforeOutput();
        this.closeText();
        console.log(
          dim(
            `usage: prompt=${event.usage.promptTokens}, ` +
              `completion=${event.usage.completionTokens}, total=${event.usage.totalTokens}`,
          ),
        );
        break;
      case "done":
        this.beforeOutput();
        this.closeText();
        if (!this.sawText && event.answer) {
          console.log(event.answer);
        }
        break;
    }
  }

  finish(): void {
    this.beforeOutput();
    this.closeText();
  }


  private beforeOutput(): void {
    if (this.thinkingShown) {
      process.stdout.write("\r\x1b[K");
      this.thinkingShown = false;
    }
  }


  private closeText(): void {
    if (this.textOpen) {
      process.stdout.write("\n");
      this.textOpen = false;
    }
  }
}


class DebugRenderer implements Renderer {
  start(): void {}

  handle(event: AgentEvent): void {
    console.error(`[debug] ${formatEvent(event)}`);
    if (event.type === "done") {
      console.log(event.answer);
    }
  }

  finish(): void {}
}


function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case "text":
      return `text: "${truncate(event.text, 120)}"`;
    case "text_delta":
      return `text_delta: ${JSON.stringify(event.delta)}`;
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


function summarizeInput(input: Record<string, unknown>): string {
  const key = input["path"] ?? input["command"];
  const text = typeof key === "string" ? key : JSON.stringify(input);
  return truncate(text.replace(/\s+/g, " ").trim(), 120);
}

function firstLine(text: string): string {
  const index = text.indexOf("\n");
  return index === -1 ? text : text.slice(0, index);
}

function formatChars(length: number): string {
  return length >= 1000 ? `${(length / 1000).toFixed(1)}k chars` : `${length} chars`;
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars total)` : text;
}
