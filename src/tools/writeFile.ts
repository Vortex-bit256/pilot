import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "./types.js";

export const writeFileTool: Tool = {
  definition: {
    name: "write_file",
    description: "Write content to a file at the given path (creates or overwrites)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Content to write into the file" },
      },
      required: ["path", "content"],
    },
  },
  async execute(input) {
    const path = String(input.path ?? "");
    if (!path) {
      return { content: "Missing required parameter: path", isError: true };
    }
    const content = String(input.content ?? "");
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      return { content: `Wrote ${content.length} characters to "${path}"` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to write "${path}": ${message}`, isError: true };
    }
  },
};
