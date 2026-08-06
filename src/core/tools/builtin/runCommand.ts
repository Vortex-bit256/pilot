import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../tool.js";

const execAsync = promisify(exec);

const TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1024 * 1024;

interface ExecError {
  message?: string;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
}

export const runCommandTool = defineTool({
  name: "run_command",
  description: "Run a shell command and return its stdout/stderr",
  kind: "exec",
  schema: z.object({
    command: z.string().min(1).describe("Shell command to execute"),
  }),
  async execute({ command }, ctx) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        signal: ctx.signal,
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
});
