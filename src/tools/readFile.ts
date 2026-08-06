import { readFile } from "node:fs/promises";
import type { Tool } from "./types.js";

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description: "Read the contents of a file at the given path",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
      },
      required: ["path"],
    },
  },
  async execute(input) {
    const path = String(input.path ?? "");
    if (!path) {
      return { content: "Missing required parameter: path", isError: true };
    }
    try {
      const content = await readFile(path, "utf8");
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to read "${path}": ${message}`, isError: true };
    }
  },
};
