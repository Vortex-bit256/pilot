import type { Agent } from "../core/agent/agent.js";
import type { AgentEvent, TokenUsage } from "../protocol/index.js";
import { ellipsize, isTTY, theme } from "./ansi.js";
import { diffLines, type DiffLine } from "./diff.js";
import { glyphs, Spinner, termWidth } from "./ui.js";

export interface RenderOptions {

  debug: boolean;

  signal?: AbortSignal;
}


export async function runAndRender(
  agent: Agent,
  task: string,
  options: RenderOptions,
): Promise<string> {
  const renderer: Renderer = options.debug ? new DebugRenderer() : new LiveRenderer();
  renderer.start();
  const stream = agent.run(task, { signal: options.signal });

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
  private spinner: Spinner | undefined;
  private startedAt = 0;

  private llmStartedAt = 0;

  private activeTool: { name: string; summary: string; startedAt: number } | undefined;
  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private sawUsage = false;


  start(): void {
    this.startedAt = Date.now();
    this.llmStartedAt = this.startedAt;
    if (isTTY) {
      this.spinner = new Spinner("Thinking…");
      this.spinner.start();
    }
  }

  handle(event: AgentEvent): void {
    switch (event.type) {
      case "text_delta":
        this.beforeOutput();
        this.noteThinkingDone();
        process.stdout.write(event.delta);
        this.textOpen = true;
        this.sawText = true;
        break;
      case "text":
        this.beforeOutput();
        this.noteThinkingDone();
        process.stdout.write(event.text);
        this.textOpen = true;
        this.sawText = true;
        break;
      case "tool_call":
        this.beforeOutput();
        this.closeText();
        this.noteThinkingDone();
        this.printToolCall(event);
        break;
      case "tool_progress":
        this.printToolProgress(event);
        break;
      case "tool_result":
        this.beforeOutput();
        this.printToolResult(event);
        this.activeTool = undefined;
        this.resumeSpinner();
        break;

      case "usage":
        this.totalUsage.promptTokens += event.usage.promptTokens;
        this.totalUsage.completionTokens += event.usage.completionTokens;
        this.totalUsage.totalTokens += event.usage.totalTokens;
        this.sawUsage = true;
        this.llmStartedAt = Date.now();
        break;
      case "done":
        this.beforeOutput();
        this.closeText();
        if (!this.sawText && event.answer) {
          console.log(event.answer);
        }
        break;
      case "cancelled":
        this.beforeOutput();
        this.closeText();
        console.log(theme.warning("◌ task cancelled"));
        break;
    }
  }

  finish(): void {
    this.beforeOutput();
    this.activeTool = undefined;
    this.closeText();
    this.printFooter();
  }


  private beforeOutput(): void {
    this.spinner?.stop();
    this.spinner = undefined;
  }


  private resumeSpinner(): void {
    if (!isTTY) return;
    this.llmStartedAt = Date.now();
    this.spinner = new Spinner("Thinking…");
    this.spinner.start();
  }


  private noteThinkingDone(): void {
    if (this.llmStartedAt === 0) return;
    const seconds = (Date.now() - this.llmStartedAt) / 1000;
    this.llmStartedAt = 0;
    if (seconds >= 1.5) {
      console.log(theme.faint(`✶ thought for ${seconds.toFixed(1)}s`));
      console.log();
    }
  }


  private closeText(): void {
    if (this.textOpen) {
      process.stdout.write("\n\n");
      this.textOpen = false;
    }
  }

  private printToolCall(event: Extract<AgentEvent, { type: "tool_call" }>): void {
    const { call } = event;
    const summary = summarizeInput(call.input);
    const icon = theme.accent(glyphs.arrow);
    console.log(`${icon} ${theme.accent(call.name)} ${theme.muted(summary)}`);


    this.activeTool = { name: call.name, summary, startedAt: Date.now() };
    if (isTTY) {
      this.spinner = new Spinner(`Running ${call.name}…`);
      this.spinner.start();
    }
  }


  private printToolProgress(event: Extract<AgentEvent, { type: "tool_progress" }>): void {
    const tool = this.activeTool;
    if (!tool || tool.name !== event.call.name) return;
    const { progress } = event;
    const lines = progress.output ?? [];
    const bar = theme.faint(glyphs.vertical) + " ";
    const label = `${tool.name}: ${progress.label}`;

    if (isTTY) {
      if (lines.length > 0) {
        this.spinner?.stop();
        for (const line of lines) {
          console.log(bar + theme.muted(ellipsize(line, termWidth() - 6)));
        }
        this.spinner = new Spinner(ellipsize(label, termWidth() - 24));
        this.spinner.start();
      } else if (this.spinner) {

        this.spinner.setLabel(ellipsize(label, termWidth() - 24));
      } else {
        this.spinner = new Spinner(ellipsize(label, termWidth() - 24));
        this.spinner.start();
      }
      return;
    }


    if (lines.length === 0) {
      console.log(bar + theme.faint(progress.label));
      return;
    }
    for (const line of lines) {
      console.log(bar + theme.muted(ellipsize(line, termWidth() - 6)));
    }
  }


  private printToolResult(event: Extract<AgentEvent, { type: "tool_result" }>): void {
    const { call, result } = event;
    const bar = theme.faint(glyphs.vertical) + " ";
    const duration = this.activeTool
      ? theme.faint(` · ${((Date.now() - this.activeTool.startedAt) / 1000).toFixed(1)}s`)
      : "";

    if (result.isError) {
      console.log(bar + theme.error(`${glyphs.cross} ${call.name} failed`) + duration);
      for (const line of truncateLines(result.content, 6, termWidth() - 6)) {
        console.log(bar + theme.error(line));
      }
      console.log();
      return;
    }


    const size = theme.faint(` · ${formatChars(result.content.length)}`);
    console.log(bar + theme.success(`${glyphs.check} ${call.name}`) + duration + size);

    for (const line of previewResult(result.content)) {
      console.log(bar + line);
    }
    console.log();
  }


  private printFooter(): void {
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const parts = [theme.text(`${elapsed}s`)];
    if (this.sawUsage) {
      parts.push(
        theme.muted(`↑${formatTokens(this.totalUsage.promptTokens)} in`),
        theme.muted(`↓${formatTokens(this.totalUsage.completionTokens)} out`),
      );
    }
    console.log(theme.faint("  ") + parts.join(theme.faint(`  ${glyphs.dot}  `)));
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
    case "tool_progress":
      return (
        `.. tool progress: ${event.call.name}: ${event.progress.label}` +
        (event.progress.output?.length
          ? ` | +${event.progress.output.length} lines: ${truncate(event.progress.output.at(-1) ?? "", 80)}`
          : "")

      );
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
    case "cancelled":
      return "cancelled";
  }
}


function summarizeInput(input: Record<string, unknown>): string {
  const key = input["path"] ?? input["command"];
  const text = typeof key === "string" ? key : JSON.stringify(input);
  return truncate(text.replace(/\s+/g, " ").trim(), 120);
}


function previewResult(content: string): string[] {
  if (!content.trim()) {
    return [];
  }
  const lines = truncateLines(content, 3, termWidth() - 6);
  return lines.map((line) => theme.muted(line));
}


function truncateLines(text: string, maxLines: number, maxWidth: number): string[] {
  const lines = text.split("\n").slice(0, maxLines);
  const clipped = lines.map((line) => ellipsize(line, maxWidth));
  const rest = text.split("\n").length - lines.length;
  if (rest > 0) {
    clipped.push(theme.faint(`… ${rest} more lines`));
  }
  return clipped;
}


export function renderDiffLines(lines: DiffLine[]): string[] {
  return lines.map((line) => {
    switch (line.type) {
      case "del":
        return theme.diffDel(`- ${line.text}`);
      case "add":
        return theme.diffAdd(`+ ${line.text}`);
      case "gap":
        return theme.faint("  …");
      default:
        return theme.diffContext(`  ${line.text}`);
    }
  });
}

export { diffLines };

function formatChars(length: number): string {
  return length >= 1000 ? `${(length / 1000).toFixed(1)}k chars` : `${length} chars`;
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars total)` : text;
}
