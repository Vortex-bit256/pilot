import * as readline from "node:readline";
import type { Agent } from "../core/agent/agent.js";
import {
  describePermissionMode,
  parsePermissionMode,
  PERMISSION_MODES,
} from "../core/agent/permissions.js";
import { theme, themeBold, ellipsize } from "./ansi.js";
import { createCliApprovalHandler, readlineQuestion } from "./approval.js";
import { runAndRender, type RenderOptions } from "./render.js";
import { box, glyphs, keycap } from "./ui.js";


interface KeypressKey {
  name?: string;
}

const PROMPT = `${theme.primary("❯")} `;

export async function runRepl(agent: Agent, options: RenderOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
  });


  let currentTask: AbortController | undefined;


  if (process.stdin.isTTY) {
    agent.setApprovalHandler(
      createCliApprovalHandler({
        cwd: process.cwd(),
        question: readlineQuestion(rl),
      }),
    );
  }

  printHints(agent);
  rl.prompt();


  (process.stdin as NodeJS.EventEmitter).on("keypress", (_str: unknown, key: KeypressKey) => {

    if (key?.name === "escape" && currentTask && !currentTask.signal.aborted) {
      console.log(theme.faint("\n(cancelling the task…)"));
      currentTask.abort();
    }
  });


  rl.on("SIGINT", () => {
    if (currentTask && !currentTask.signal.aborted) {
      console.log(theme.faint("\n(cancelling the task…)"));
      currentTask.abort();
      return;
    }
    console.log(theme.faint("\n(press Ctrl+C again or type 'exit' to quit)"));
    rl.prompt();
  });

  for await (const line of rl) {
    const input = line.trim();
    const command = input.startsWith("/") ? input.slice(1) : input;

    if (command === "exit" || command === "quit") {
      rl.close();
      break;
    }

    if (command === "help") {
      printHelp();
      rl.prompt();
      continue;
    }

    if (command === "mode" || command.startsWith("mode ")) {
      handleModeCommand(agent, command.slice("mode".length).trim());
      rl.prompt();
      continue;
    }

    if (input) {
      echoTask(input);
      const controller = new AbortController();
      currentTask = controller;
      try {
        await runAndRender(agent, input, { ...options, signal: controller.signal });
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(theme.error(`\n${glyphs.cross} ${message}`) + "\n");
      } finally {
        currentTask = undefined;
      }
    }

    rl.prompt();
  }

  console.log(theme.faint("bye"));
}


function printHints(agent: Agent): void {
  console.log(
    "  " +
      theme.faint("type ") +
      theme.muted("help") +
      theme.faint(" for commands  ·  ") +
      keycap("esc") +
      theme.faint(" cancels a running task  ·  mode: ") +
      theme.muted(agent.permissionMode),
  );
  console.log();
}


function echoTask(input: string): void {
  const preview = input.length > 200 ? ellipsize(input, 200) : input;
  console.log();
  console.log(
    box(preview, {
      title: "you",
      titleColor: theme.muted,
      border: theme.faint,
      minWidth: 34,
    }),
  );
}

function printHelp(): void {
  console.log();
  console.log(
    box(
      [
        `${themeBold.text("help")}          ${theme.muted("Show this help")}`,
        `${themeBold.text("mode")} [name]   ${theme.muted("Show or switch the permission mode")}`,
        `${themeBold.text("exit")}          ${theme.muted("Quit (also: quit, Ctrl+C, Ctrl+D)")}`,
        "",
        theme.muted("While a task is running, ") +
          keycap("esc") +
          theme.muted(" or ") +
          keycap("ctrl+c") +
          theme.muted(" cancels it."),
        theme.muted('Commands also accept a "/" prefix. Anything else is sent to the agent as a task.'),
      ],
      { title: "commands", minWidth: 60 },
    ),
  );
  console.log();
}

function handleModeCommand(agent: Agent, arg: string): void {
  if (!arg) {
    console.log(
      box(
        [
          `${theme.faint("current")}   ${theme.muted(describePermissionMode(agent.permissionMode))}`,
          `${theme.faint("available")} ${PERMISSION_MODES.map((mode) =>
            mode === agent.permissionMode ? themeBold.accent(mode) : theme.muted(mode),
          ).join(theme.faint("  ·  "))}`,
        ],
        { title: "permission mode", minWidth: 56 },
      ),
    );
    return;
  }

  const mode = parsePermissionMode(arg);
  if (!mode) {
    console.log(
      theme.error(`${glyphs.cross} Unknown mode "${arg}".`) +
        theme.faint(` Available: ${PERMISSION_MODES.join(", ")}.`),
    );
    return;
  }

  agent.setPermissionMode(mode);
  if (mode === "free") {
    console.log(
      theme.error("⚠ FREE MODE: the agent will run ALL tool calls, including shell commands, without asking."),
    );
    console.log(theme.error('  Not recommended — type "mode work" or "mode safe" to re-enable approvals.'));
  } else {
    console.log(
      theme.success(glyphs.check) +
        " " +
        theme.muted(`Permission mode: ${describePermissionMode(mode)}`),
    );
  }
}
