import * as readline from "node:readline";
import type { Agent } from "../core/agent/agent.js";
import { runAndRender, type RenderOptions } from "./render.js";

const HELP = `Commands:
  help    Show this help
  exit    Quit (also: quit, Ctrl+C, Ctrl+D)
Anything else is sent to the agent as a task.`;

export async function runRepl(agent: Agent, options: RenderOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log("simple-agent ready. Type 'help' for commands, 'exit' to quit.");
  rl.prompt();


  rl.on("SIGINT", () => {
    console.log("\n(press Ctrl+C again or type 'exit' to quit)");
    rl.prompt();
  });

  for await (const line of rl) {
    const input = line.trim();

    if (input === "exit" || input === "quit") {
      rl.close();
      break;
    }

    if (input === "help") {
      console.log(HELP);
      rl.prompt();
      continue;
    }

    if (input) {
      try {
        const answer = await runAndRender(agent, input, options);
        console.log(`\n${answer}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\nError: ${message}\n`);
      }
    }

    rl.prompt();
  }
}
