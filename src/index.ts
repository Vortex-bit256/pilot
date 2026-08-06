import { runAndRender } from "./cli/render.js";
import { runRepl } from "./cli/repl.js";
import { Agent } from "./core/agent/agent.js";
import { loadConfig } from "./core/config/config.js";
import { registerBuiltinProviders } from "./core/llm/providers/index.js";
import { createProvider } from "./core/llm/registry.js";
import { builtinTools } from "./core/tools/builtin/index.js";
import { ToolRegistry } from "./core/tools/registry.js";

const SYSTEM_PROMPT = `You are a coding agent running in a terminal.
You help the user with programming tasks in the current working directory.
Use the available tools to inspect the project (list_files, read_file), modify it
(write_file, edit_file) and verify your changes (run_command).
Prefer edit_file for small changes to existing files and write_file for new files.
Explain briefly what you are doing and keep answers concise.`;

const USAGE = `Usage:
  npm run dev                     Start the interactive REPL
  npm run dev -- "task"           Run a single task and exit
  npm run dev -- --debug "task"   Same, with verbose debug logs on stderr

Options:
  --debug, -d   Log every agent event to stderr (same as AGENT_DEBUG=1)
  --help,  -h   Show this help`;

interface CliArgs {
  debug: boolean;
  task?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { debug: false };
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--debug" || arg === "-d") {
      result.debug = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    result.task = positional.join(" ");
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));


  const config = loadConfig(args.debug ? { debug: true } : {});


  registerBuiltinProviders();
  const llm = createProvider(config.provider);

  const tools = new ToolRegistry();
  tools.registerAll(builtinTools);

  const agent = new Agent(
    {
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      maxIterations: config.maxIterations,
    },
    llm,
    tools,
    { cwd: process.cwd() },
  );

  console.error(`Provider: ${llm.id}, model: ${config.model}`);

  if (args.task) {

    const answer = await runAndRender(agent, args.task, { debug: config.debug });
    console.log(answer);
    return;
  }

  await runRepl(agent, { debug: config.debug });
}

main().catch((error: unknown) => {
  const debug = isDebugMode();
  console.error(error instanceof Error ? (debug ? (error.stack ?? error.message) : error.message) : error);
  process.exit(1);
});


function isDebugMode(): boolean {
  const env = process.env.AGENT_DEBUG?.trim().toLowerCase();
  return env === "1" || env === "true" || process.argv.includes("--debug") || process.argv.includes("-d");
}
