import * as readline from "node:readline";
import type { Agent } from "../core/agent/agent.js";
import {
  describePermissionMode,
  parsePermissionMode,
  PERMISSION_MODES,
} from "../core/agent/permissions.js";
import { red, yellow } from "./ansi.js";
import { createCliApprovalHandler } from "./approval.js";
import { runAndRender, type RenderOptions } from "./render.js";

const HELP = `Commands:
  help          Show this help
  mode [name]   Show or switch the permission mode (safe, work, free)
  exit          Quit (also: quit, Ctrl+C, Ctrl+D)
Commands also accept a "/" prefix. Anything else is sent to the agent as a task.`;

export async function runRepl(agent: Agent, options: RenderOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });


  if (process.stdin.isTTY) {
    agent.setApprovalHandler(
      createCliApprovalHandler({
        cwd: process.cwd(),
        question: (query) => new Promise<string>((resolve) => rl.question(query, resolve)),
      }),
    );
  }

  console.log("simple-agent ready. Type 'help' for commands, 'exit' to quit.");
  rl.prompt();


  rl.on("SIGINT", () => {
    console.log("\n(press Ctrl+C again or type 'exit' to quit)");
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
      console.log(HELP);
      rl.prompt();
      continue;
    }

    if (command === "mode" || command.startsWith("mode ")) {
      handleModeCommand(agent, command.slice("mode".length).trim());
      rl.prompt();
      continue;
    }

    if (input) {
      try {

        await runAndRender(agent, input, options);
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\nError: ${message}\n`);
      }
    }

    rl.prompt();
  }
}

function handleModeCommand(agent: Agent, arg: string): void {
  if (!arg) {
    console.log(`Permission mode: ${describePermissionMode(agent.permissionMode)}`);
    console.log(`Available: ${PERMISSION_MODES.join(", ")} — switch with "mode <name>".`);
    return;
  }

  const mode = parsePermissionMode(arg);
  if (!mode) {
    console.log(`Unknown mode "${arg}". Available: ${PERMISSION_MODES.join(", ")}.`);
    return;
  }

  agent.setPermissionMode(mode);
  if (mode === "free") {
    console.log(
      red("⚠ FREE MODE: the agent will run ALL tool calls, including shell commands, without asking."),
    );
    console.log(red('  Not recommended — type "mode work" or "mode safe" to re-enable approvals.'));
  } else {
    console.log(yellow(`Permission mode: ${describePermissionMode(mode)}`));
  }
}
