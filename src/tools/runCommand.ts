import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "./types.js";

const execAsync = promisify(exec);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1024 * 1024;

interface ExecError {
  message?: string;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
}

export const runCommandTool: Tool = {
  definition: {
    name: "run_command",
    description: "Run a shell command and return its stdout/stderr",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
  },
  async execute(input) {
    const command = String(input.command ?? "");
    if (!command) {
      return { content: "Missing required parameter: command", isError: true };
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      return { content: output || "(no output)" };
    } catch (error) {

      const e = error as ExecError;
      const parts = [
        e.killed
          ? `Command timed out after ${TIMEOUT_MS / 1000}s: ${command}`
          : `Command failed: ${e.message ?? String(error)}`,
        e.stdout?.trim() ? `--- stdout ---\n${e.stdout.trim()}` : "",
        e.stderr?.trim() ? `--- stderr ---\n${e.stderr.trim()}` : "",
      ].filter(Boolean);
      return { content: parts.join("\n"), isError: true };
    }
  },
};
