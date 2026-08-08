import * as readline from "node:readline";
import type { Agent } from "../core/agent/agent.js";
import {
  activeChat,
  createChat,
  saveHistory,
  updateActiveChat,
  type CliHistory,
} from "./history.js";
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

export async function runRepl(
  agent: Agent,
  options: RenderOptions & { history?: CliHistory },
): Promise<void> {
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

  printHints(agent, options.history);
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

    if (command === "chats" || command === "history") {
      printChats(options.history);
      rl.prompt();
      continue;
    }

    if (command === "chat" || command.startsWith("chat ")) {
      await handleChatCommand(agent, options.history, command.slice("chat".length).trim());
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
        if (options.history) {
          updateActiveChat(options.history, agent.snapshotMessages(), input);
          await saveHistory(options.history);
        }
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


function printHints(agent: Agent, history?: CliHistory): void {
  const chat = history ? activeChat(history) : undefined;
  console.log(
    "  " +
      theme.faint("type ") +
      theme.muted("help") +
      theme.faint(" for commands  ·  ") +
      keycap("esc") +
      theme.faint(" cancels a running task  ·  mode: ") +
      theme.muted(agent.permissionMode) +
      (chat ? theme.faint("  ·  chat: ") + theme.muted(chat.title) : ""),
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
        `${themeBold.text("chats")}         ${theme.muted("List saved chats")}`,
        `${themeBold.text("chat new")}      ${theme.muted("Start a new chat")}`,
        `${themeBold.text("chat use")} N    ${theme.muted("Switch to a saved chat")}`,
        `${themeBold.text("chat delete")} N ${theme.muted("Delete a saved chat")}`,
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


function printChats(history: CliHistory | undefined): void {
  if (!history) {
    console.log(theme.warning(`${glyphs.warn} Chat history is unavailable in this run.`));
    return;
  }

  const lines = history.chats.map((chat, index) => {
    const marker = chat.id === history.activeChatId ? theme.success(glyphs.check) : " ";
    const number = theme.faint(String(index + 1).padStart(2, " "));
    const title = chat.id === history.activeChatId ? themeBold.accent(chat.title) : theme.muted(chat.title);
    const count = theme.faint(`${chat.messages.filter((message) => message.role === "user").length} turns`);
    return `${marker} ${number}  ${title}  ${count}`;
  });

  console.log();
  console.log(box(lines, { title: "chats", minWidth: 64 }));
  console.log();
}


async function handleChatCommand(
  agent: Agent,
  history: CliHistory | undefined,
  arg: string,
): Promise<void> {
  if (!history) {
    console.log(theme.warning(`${glyphs.warn} Chat history is unavailable in this run.`));
    return;
  }

  if (!arg) {
    printChats(history);
    return;
  }

  if (arg === "new") {
    updateActiveChat(history, agent.snapshotMessages());
    const chat = createChat();
    history.chats.unshift(chat);
    history.activeChatId = chat.id;
    agent.replaceMessages([]);
    await saveHistory(history);
    console.log(theme.success(`${glyphs.check} New chat started.`));
    return;
  }

  if (arg.startsWith("use ")) {
    const chat = findChat(history, arg.slice("use ".length).trim());
    if (!chat) {
      console.log(theme.error(`${glyphs.cross} Chat not found.`));
      return;
    }
    updateActiveChat(history, agent.snapshotMessages());
    history.activeChatId = chat.id;
    agent.replaceMessages(chat.messages);
    await saveHistory(history);
    console.log(theme.success(`${glyphs.check} Switched to "${chat.title}".`));
    return;
  }

  if (arg.startsWith("delete ")) {
    const chat = findChat(history, arg.slice("delete ".length).trim());
    if (!chat) {
      console.log(theme.error(`${glyphs.cross} Chat not found.`));
      return;
    }
    history.chats = history.chats.filter((item) => item.id !== chat.id);
    if (history.chats.length === 0) {
      history.chats.push(createChat());
    }
    if (history.activeChatId === chat.id) {
      history.activeChatId = history.chats[0].id;
      agent.replaceMessages(activeChat(history).messages);
    }
    await saveHistory(history);
    console.log(theme.success(`${glyphs.check} Deleted "${chat.title}".`));
    return;
  }

  console.log(theme.error(`${glyphs.cross} Unknown chat command.`) + theme.faint(" Try: chats, chat new, chat use N, chat delete N."));
}


function findChat(history: CliHistory, value: string) {
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= history.chats.length) {
    return history.chats[index - 1];
  }
  return history.chats.find((chat) => chat.id === value);
}
