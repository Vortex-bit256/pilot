


import {
  ellipsize,
  isTTY,
  stripAnsi,
  theme,
  useColor,
  visibleWidth,
} from "./ansi.js";
import { HIDE_CURSOR, SHOW_CURSOR } from "./ansi.js";


const GLYPHS = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",

  bar: "▍",
  bullet: "●",
  diamond: "◆",
  arrow: "→",
  back: "←",
  check: "✓",
  cross: "✗",
  warn: "⚠",
  dot: "·",
  sparkle: "✦",
} as const;

export const glyphs = GLYPHS;


export function termWidth(): number {
  return Math.max(40, process.stdout.columns ?? 80);
}


export function divider(label?: string): string {
  const width = Math.min(termWidth(), 100);
  if (!label) {
    return theme.faint(GLYPHS.horizontal.repeat(width));
  }
  const text = ` ${label} `;
  const remaining = Math.max(0, width - text.length);
  const left = Math.floor(remaining / 2);
  return (
    theme.faint(GLYPHS.horizontal.repeat(left)) +
    theme.muted(text) +
    theme.faint(GLYPHS.horizontal.repeat(remaining - left))
  );
}


export function padEndVisible(text: string, width: number): string {
  const padding = width - visibleWidth(text);
  return padding > 0 ? text + " ".repeat(padding) : text;
}

export interface BoxOptions {

  title?: string;

  footer?: string;

  paddingX?: number;

  minWidth?: number;

  maxWidth?: number;

  border?: (text: string) => string;

  titleColor?: (text: string) => string;
}


export function box(content: string | string[], options: BoxOptions = {}): string {
  const lines = Array.isArray(content) ? content : content.split("\n");
  const paddingX = options.paddingX ?? 1;
  const maxWidth = Math.min(options.maxWidth ?? termWidth() - 2, 110);
  const border = options.border ?? theme.faint;
  const titleColor = options.titleColor ?? theme.muted;

  const title = options.title ? ` ${options.title} ` : "";
  const footer = options.footer ? ` ${options.footer} ` : "";
  const natural = Math.max(
    ...lines.map((line) => visibleWidth(line)),
    title.length,
    footer.length,
    1,
  );
  const innerWidth = Math.max(
    Math.min(natural, maxWidth - 2 - paddingX * 2),
    (options.minWidth ?? 0) - 2 - paddingX * 2,
    1,
  );
  const width = innerWidth + paddingX * 2;

  const topFill = Math.max(0, width - title.length);
  const top =
    border(GLYPHS.topLeft + GLYPHS.horizontal) +
    (options.title ? titleColor(title) : "") +
    border(GLYPHS.horizontal.repeat(topFill) + GLYPHS.topRight);

  const footerFill = Math.max(0, width - footer.length);
  const bottom = options.footer
    ? border(GLYPHS.bottomLeft + GLYPHS.horizontal.repeat(footerFill)) +
      theme.faint(footer) +
      border(GLYPHS.horizontal + GLYPHS.bottomRight)
    : border(GLYPHS.bottomLeft + GLYPHS.horizontal.repeat(width) + GLYPHS.bottomRight);

  const pad = " ".repeat(paddingX);
  const body = lines.map(
    (line) =>
      border(GLYPHS.vertical) +
      pad +
      padEndVisible(ellipsizeVisible(line, innerWidth), innerWidth) +
      pad +
      border(GLYPHS.vertical),
  );

  return [top, ...body, bottom].join("\n");
}


function ellipsizeVisible(line: string, width: number): string {
  if (visibleWidth(line) <= width) return line;


  return ellipsize(stripAnsi(line), width);
}


export function barBlock(title: string, lines: string[], options: {
  color?: (text: string) => string;
  titleColor?: (text: string) => string;
} = {}): string {
  const color = options.color ?? theme.faint;
  const titleColor = options.titleColor ?? theme.text;
  const bar = color(GLYPHS.bar) + " ";
  const out = [bar + titleColor(title)];
  for (const line of lines) {
    out.push(bar + line);
  }
  return out.join("\n");
}


const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];


export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private frame = 0;
  private active = false;
  private startedAt = 0;

  constructor(private label: string) {}

  start(): void {
    if (!isTTY || this.active) return;
    this.active = true;
    this.startedAt = Date.now();
    process.stdout.write(HIDE_CURSOR);
    this.draw();
    this.timer = setInterval(() => this.draw(), 80);

    this.timer.unref();
  }

  setLabel(label: string): void {
    this.label = label;
  }


  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (isTTY) {
      process.stdout.write("\r\x1b[K" + SHOW_CURSOR);
    }
  }

  private draw(): void {
    const frame = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    this.frame++;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(0);
    process.stdout.write(
      `\r\x1b[K${theme.accent(frame)} ${theme.muted(this.label)} ${theme.faint(`${elapsed}s · esc to cancel`)}`,
    );
  }
}


export function banner(version: string, extra?: { provider?: string; model?: string }): string {
  const logo = [
    theme.primary("  ▄▄ ▄▄"),
    theme.primary("  █  █  ") + theme.text("simple-agent ") + theme.muted(`v${version}`),
    theme.primary("  ▀▀▀▀  ") + theme.muted("coding agent"),
  ];

  const lines: string[] = [...logo];
  if (extra?.provider || extra?.model) {
    lines.push(
      "        " +
        theme.faint("provider ") +
        theme.muted(extra.provider ?? "?") +
        theme.faint("  ·  model ") +
        theme.muted(extra.model ?? "?"),
    );
  }
  return lines.join("\n");
}


export function keycap(label: string): string {
  return useColor ? theme.faint("[") + theme.muted(label) + theme.faint("]") : `[${label}]`;
}
