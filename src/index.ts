import * as readline from "node:readline";
import { dim, red } from "./cli/ansi.js";
import { createCliApprovalHandler } from "./cli/approval.js";
import { runAndRender } from "./cli/render.js";
import { runRepl } from "./cli/repl.js";
import { Agent } from "./core/agent/agent.js";
import {
  describePermissionMode,
  parsePermissionMode,
  PERMISSION_MODES,
} from "./core/agent/permissions.js";
import { loadConfig, type ConfigLayer } from "./core/config/config.js";
import { registerBuiltinProviders } from "./core/llm/providers/index.js";
import { createProvider } from "./core/llm/registry.js";
import { builtinTools } from "./core/tools/builtin/index.js";
import { ToolRegistry } from "./core/tools/registry.js";
import type { PermissionMode } from "./protocol/index.js";


const SYSTEM_PROMPT = `You are a coding agent running in a terminal.
You help the user with programming tasks in the current working directory.
Use the available tools to inspect the project (list_files, read_file), modify it
(write_file, edit_file) and verify your changes (run_command).
Prefer edit_file for small changes to existing files and write_file for new files.
Explain briefly what you are doing and keep answers concise.`;

const USAGE = `Usage:
  npm run dev                            Start the interactive REPL
  npm run dev -- "task"                  Run a single task and exit
  npm run dev -- --mode work "task"      Same, with a different permission mode

Options:
  --debug, -d       Log every agent event to stderr (same as AGENT_DEBUG=1)
  --no-stream       Wait for full LLM responses instead of streaming tokens
  --mode,  -m MODE  Permission mode: safe (default), work, free
  --yes,   -y       Alias for --mode free: auto-approve ALL tool calls (dangerous)
  --help,  -h       Show this help`;

interface CliArgs {
  debug: boolean;
  stream: boolean;
  mode?: PermissionMode;
  task?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { debug: false, stream: true };
  const positional: string[] = [];

  const setMode = (raw: string | undefined): void => {
    const parsed = raw ? parsePermissionMode(raw) : undefined;
    if (!parsed) {
      console.error(
        `Invalid permission mode "${raw ?? ""}". Expected one of: ${PERMISSION_MODES.join(", ")}.`,
      );
      process.exit(1);
    }
    result.mode = parsed;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--debug" || arg === "-d") {
      result.debug = true;
    } else if (arg === "--no-stream") {
      result.stream = false;
    } else if (arg === "--mode" || arg === "-m") {
      setMode(argv[++i]);
    } else if (arg.startsWith("--mode=")) {
      setMode(arg.slice("--mode=".length));
    } else if (arg === "--yes" || arg === "-y") {
      result.mode = "free";
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


  const cliOverrides: ConfigLayer = {};
  if (args.debug) cliOverrides.debug = true;
  if (!args.stream) cliOverrides.streaming = false;
  if (args.mode) cliOverrides.permissionMode = args.mode;
  const config = loadConfig(cliOverrides);


  registerBuiltinProviders();
  const llm = createProvider(config.provider);

  const tools = new ToolRegistry();
  tools.registerAll(builtinTools);

  const agent = new Agent(
    {
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      maxIterations: config.maxIterations,
      streaming: config.streaming,
      permissionMode: config.permissionMode,
    },
    llm,
    tools,
    { cwd: process.cwd() },
  );

  console.error(`Provider: ${llm.id}, model: ${config.model}`);
  console.error(`Permissions: ${describePermissionMode(config.permissionMode)}`);
  if (config.permissionMode === "free") {
    console.error(
      red("⚠ FREE MODE: all tool calls, including shell commands, run WITHOUT confirmation."),
    );
  } else if (!process.stdin.isTTY) {
    console.error(
      dim(
        "Non-interactive stdin: tool calls that need approval will be auto-denied " +
          "(use --mode free to allow them).",
      ),
    );
  }

  if (args.task) {


    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      agent.setApprovalHandler(
        createCliApprovalHandler({
          cwd: process.cwd(),
          question: (query) => new Promise<string>((resolve) => rl.question(query, resolve)),
        }),
      );
      try {
        await runAndRender(agent, args.task, { debug: config.debug });
      } finally {
        rl.close();
      }
    } else {
      await runAndRender(agent, args.task, { debug: config.debug });
    }
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
