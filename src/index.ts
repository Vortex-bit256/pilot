import { Agent } from "./agent/agent.js";
import { runRepl } from "./cli/repl.js";
import { loadConfig } from "./config.js";
import { DeepSeekProvider } from "./llm/deepseek.js";
import { getToolDefinitions } from "./tools/index.js";

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
  --debug, -d   Log every LLM response and tool call to stderr (same as AGENT_DEBUG=1)
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
  const config = loadConfig();

  const llm = new DeepSeekProvider(config.apiKey, config.baseUrl);

  const agent = new Agent(
    {
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      tools: getToolDefinitions(),
      maxIterations: config.maxIterations,
      debug: config.debug || args.debug,
    },
    llm,
  );

  console.error(`Connected to DeepSeek API (model: ${config.model})`);

  if (args.task) {

    const answer = await agent.run(args.task);
    console.log(answer);
    return;
  }

  await runRepl(agent);
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
