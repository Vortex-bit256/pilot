import { spawn } from "node:child_process";
import { z } from "zod";
import { defineTool } from "../tool.js";

const TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 1024 * 1024;

const MAX_REPORT_LINES = 10;

export const runCommandTool = defineTool({
  name: "run_command",
  description: "Run a shell command and return its stdout/stderr",
  kind: "exec",
  schema: z.object({
    command: z.string().min(1).describe("Shell command to execute"),
  }),
  async execute({ command }, ctx) {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";

    const report = (lines: string[] = []) => {
      ctx.onProgress?.({
        stage: "run",
        label: `running for ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
        elapsed: (Date.now() - startedAt) / 1000,
        output:
          lines.length > MAX_REPORT_LINES
            ? [...lines.slice(0, MAX_REPORT_LINES), `… ${lines.length - MAX_REPORT_LINES} more lines`]
            : lines,
      });
    };

    return await new Promise<{ content: string; isError?: boolean }>((resolvePromise) => {

      const child = spawn(command, {
        cwd: ctx.cwd,
        shell: true,
        signal: ctx.signal,
        timeout: TIMEOUT_MS,
      });

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      const feedStdout = makeLineFeeder();
      const feedStderr = makeLineFeeder();

      child.stdout?.on("data", (chunk: string) => {
        stdout = appendCapped(stdout, chunk);
        report(feedStdout(chunk));
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr = appendCapped(stderr, chunk);
        report(feedStderr(chunk));
      });


      const heartbeat = setInterval(() => report(), 1000);

      heartbeat.unref?.();


      let settled = false;
      const finish = (result: { content: string; isError?: boolean }) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        resolvePromise(result);
      };

      const captured = () =>
        [
          stdout.trim() ? `--- stdout ---\n${stdout.trim()}` : "",
          stderr.trim() ? `--- stderr ---\n${stderr.trim()}` : "",
        ].filter(Boolean);

      child.on("error", (error: NodeJS.ErrnoException) => {

        const head = ctx.signal?.aborted
          ? `Command was cancelled: ${command}`
          : `Command failed to start: ${error.message}`;
        finish({ content: [head, ...captured()].join("\n"), isError: true });
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        if (ctx.signal?.aborted) {
          finish({ content: [`Command was cancelled: ${command}`, ...captured()].join("\n"), isError: true });
          return;
        }


        if (signal || code === null) {
          finish({
            content: [
              `Command timed out after ${TIMEOUT_MS / 1000}s: ${command}`,
              ...captured(),
            ].join("\n"),
            isError: true,
          });
          return;
        }

        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        if (code === 0) {
          finish({ content: output || "(no output)" });
          return;
        }
        finish({
          content: [
            `Command exited with code ${code}: ${command}`,
            output,
          ].filter(Boolean).join("\n"),
          isError: true,
        });
      });
    });
  },
});


function makeLineFeeder(): (chunk: string) => string[] {
  let pending = "";
  return (chunk: string): string[] => {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0);
  };
}


function appendCapped(buffer: string, chunk: string): string {
  const combined = buffer + chunk;
  if (combined.length <= MAX_BUFFER_BYTES) {
    return combined;
  }
  return combined.slice(combined.length - MAX_BUFFER_BYTES);
}
