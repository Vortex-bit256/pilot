import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ApprovalRequest, ToolCall } from "../protocol/index.js";
import type { ApprovalHandler } from "../core/agent/permissions.js";
import { cyan, dim, green, red, yellow } from "./ansi.js";
import { diffLines, type DiffLine } from "./diff.js";


export type QuestionFn = (query: string) => Promise<string>;

const MAX_PREVIEW_LINES = 60;
const NEW_FILE_PREVIEW_LINES = 12;


export function createCliApprovalHandler(options: {
  cwd: string;
  question: QuestionFn;
}): ApprovalHandler {
  return async (request: ApprovalRequest) => {
    const { call, kind } = request;

    console.log(yellow(`⚠ ${call.name} (${kind}) requires your approval`));
    await printPreview(call, options.cwd);

    const answer = await options.question(yellow(`Allow ${call.name}? [y/N] `));
    const allow = /^(y|yes)$/i.test(answer.trim());
    console.log(allow ? green("✓ allowed") : dim("✗ denied"));
    return allow ? "allow" : "deny";
  };
}


async function printPreview(call: ToolCall, cwd: string): Promise<void> {
  try {
    switch (call.name) {
      case "write_file":
        await previewWriteFile(call, cwd);
        return;
      case "edit_file":
        await previewEditFile(call, cwd);
        return;
      case "run_command": {
        const command = stringArg(call.input.command);
        if (command) {
          console.log(indent(cyan(command)));
          return;
        }
        break;
      }
    }
    printRawInput(call);
  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);
    console.log(dim(`(preview unavailable: ${message})`));
    printRawInput(call);
  }
}

async function previewWriteFile(call: ToolCall, cwd: string): Promise<void> {
  const path = stringArg(call.input.path);
  const content = stringArg(call.input.content);
  if (path === undefined || content === undefined) {
    printRawInput(call);
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
    console.log(dim(`  new file ${path} (${lines.length} lines):`));
    for (const line of lines.slice(0, NEW_FILE_PREVIEW_LINES)) {
      console.log(green(`+ ${line}`));
    }
    if (lines.length > NEW_FILE_PREVIEW_LINES) {
      console.log(dim(`  … ${lines.length - NEW_FILE_PREVIEW_LINES} more lines`));
    }
    return;
  }

  if (existing === content) {
    console.log(dim(`  ${path}: content identical to the current file`));
    return;
  }

  console.log(dim(`  ${path}:`));
  printDiff(diffLines(existing, content));
}

async function previewEditFile(call: ToolCall, cwd: string): Promise<void> {
  const path = stringArg(call.input.path);
  const oldString = stringArg(call.input.old_string);
  const newString = stringArg(call.input.new_string);
  if (path === undefined || oldString === undefined || newString === undefined) {
    printRawInput(call);
    return;
  }

  const content = await readFile(resolve(cwd, path), "utf8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences !== 1) {
    console.log(
      dim(`  ${path}: cannot preview (old_string occurs ${occurrences} times, the tool will reject this)`),
    );
    return;
  }

  console.log(dim(`  ${path}:`));
  printDiff(diffLines(content, content.replace(oldString, newString)));
}

function printDiff(lines: DiffLine[]): void {
  const shown = lines.slice(0, MAX_PREVIEW_LINES);
  for (const line of shown) {
    switch (line.type) {
      case "del":
        console.log(red(`- ${line.text}`));
        break;
      case "add":
        console.log(green(`+ ${line.text}`));
        break;
      case "gap":
        console.log(dim("  …"));
        break;
      default:
        console.log(dim(`  ${line.text}`));
    }
  }
  if (lines.length > MAX_PREVIEW_LINES) {
    console.log(dim(`  (preview truncated, ${lines.length - MAX_PREVIEW_LINES} more lines)`));
  }
}

function printRawInput(call: ToolCall): void {
  const json = JSON.stringify(call.input);
  console.log(indent(json.length > 300 ? `${json.slice(0, 300)}…` : json));
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

