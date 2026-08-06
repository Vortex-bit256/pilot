import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ApprovalRequest, ToolCall } from "../protocol/index.js";
import type { ApprovalHandler } from "../core/agent/permissions.js";
import { ellipsize, theme } from "./ansi.js";
import { diffLines, type DiffLine } from "./diff.js";
import { glyphs, termWidth } from "./ui.js";
import type { Interface as ReadlineInterface } from "node:readline";


export type QuestionFn = (query: string, signal?: AbortSignal) => Promise<string>;


export function readlineQuestion(rl: ReadlineInterface): QuestionFn {
  return (query, signal) =>
    new Promise<string>((resolve) => {
      if (signal?.aborted) {
        resolve("");
        return;
      }
      rl.question(query, { signal }, resolve);
      signal?.addEventListener("abort", () => resolve(""), { once: true });
    });
}


const MAX_PREVIEW_LINES = 24;
const NEW_FILE_PREVIEW_LINES = 12;


export function createCliApprovalHandler(options: {
  cwd: string;
  question: QuestionFn;
}): ApprovalHandler {
  return async (request: ApprovalRequest) => {
    const { call, kind } = request;

    console.log();
    console.log(
      theme.warning(glyphs.warn) +
        " " +
        theme.warning("approval required") +
        theme.faint("  ·  ") +
        theme.text(call.name) +
        " " +
        theme.faint(`(${kind})`),
    );
    await printPreview(call, options.cwd);

    const hint =
      theme.faint("[") + theme.success("y") + theme.faint("]") + theme.muted("es ") +
      theme.faint("[") + theme.error("n") + theme.faint("]") + theme.muted("o ") +
      theme.faint("[") + theme.accent("a") + theme.faint("]") + theme.muted("lways");
    const answer = await options.question(theme.warning("▸ ") + hint + " ", request.signal);

    const normalized = answer.trim().toLowerCase();

    if (/^(a|always)$/.test(normalized)) {
      console.log(
        theme.success(`${glyphs.check} allowed`) +
          theme.faint(` — ${call.name} won't be asked about again this session`),
      );
      return "always";
    }
    if (/^(y|yes)$/.test(normalized)) {
      console.log(theme.success(`${glyphs.check} allowed`));
      return "allow";
    }
    console.log(theme.faint(`${glyphs.cross} denied`));
    return "deny";
  };
}


async function printPreview(call: ToolCall, cwd: string): Promise<void> {
  const bar = theme.faint(glyphs.vertical) + " ";
  try {
    switch (call.name) {
      case "write_file":
        await previewWriteFile(call, cwd, bar);
        return;
      case "edit_file":
        await previewEditFile(call, cwd, bar);
        return;
      case "run_command": {
        const command = stringArg(call.input.command);
        if (command) {
          for (const line of command.split("\n")) {
            console.log(bar + theme.accent(line));
          }
          return;
        }
        break;
      }
    }
    printRawInput(call, bar);
  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);
    console.log(bar + theme.faint(`(preview unavailable: ${message})`));
    printRawInput(call, bar);
  }
}

async function previewWriteFile(call: ToolCall, cwd: string, bar: string): Promise<void> {
  const path = stringArg(call.input.path);
  const content = stringArg(call.input.content);
  if (path === undefined || content === undefined) {
    printRawInput(call, bar);
    return;
  }

  let existing: string | undefined;
  try {
    existing = await readFile(resolve(cwd, path), "utf8");
  } catch {
    existing = undefined;
  }

  if (existing === undefined) {
    const lines = content.split("\n");
    console.log(bar + theme.muted(`new file ${path} (${lines.length} lines)`));
    const maxWidth = termWidth() - 6;
    for (const line of lines.slice(0, NEW_FILE_PREVIEW_LINES)) {
      console.log(bar + theme.diffAdd("+ " + ellipsize(line, maxWidth)));
    }
    if (lines.length > NEW_FILE_PREVIEW_LINES) {
      console.log(bar + theme.faint(`… ${lines.length - NEW_FILE_PREVIEW_LINES} more lines`));
    }
    return;
  }

  if (existing === content) {
    console.log(bar + theme.faint(`${path}: content identical to the current file`));
    return;
  }

  console.log(bar + theme.muted(path));
  printDiff(diffLines(existing, content), bar);
}

async function previewEditFile(call: ToolCall, cwd: string, bar: string): Promise<void> {
  const path = stringArg(call.input.path);
  const oldString = stringArg(call.input.old_string);
  const newString = stringArg(call.input.new_string);
  if (path === undefined || oldString === undefined || newString === undefined) {
    printRawInput(call, bar);
    return;
  }

  const content = await readFile(resolve(cwd, path), "utf8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences !== 1) {
    console.log(
      bar + theme.faint(`${path}: cannot preview (old_string occurs ${occurrences} times, the tool will reject this)`),
    );
    return;
  }

  console.log(bar + theme.muted(path));
  printDiff(diffLines(content, content.replace(oldString, newString)), bar);
}

function printDiff(lines: DiffLine[], bar: string): void {
  const shown = lines.slice(0, MAX_PREVIEW_LINES);
  const maxWidth = termWidth() - 6;
  for (const line of shown) {
    switch (line.type) {
      case "del":
        console.log(bar + theme.diffDel("- " + ellipsize(line.text, maxWidth)));
        break;
      case "add":
        console.log(bar + theme.diffAdd("+ " + ellipsize(line.text, maxWidth)));
        break;
      case "gap":
        console.log(bar + theme.faint("  …"));
        break;
      default:
        console.log(bar + theme.diffContext("  " + ellipsize(line.text, maxWidth)));
    }
  }
  if (lines.length > MAX_PREVIEW_LINES) {
    console.log(bar + theme.faint(`(preview truncated, ${lines.length - MAX_PREVIEW_LINES} more lines)`));
  }
}

function printRawInput(call: ToolCall, bar: string): void {
  const json = JSON.stringify(call.input);
  console.log(bar + theme.muted(json.length > 300 ? `${json.slice(0, 300)}…` : json));
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
