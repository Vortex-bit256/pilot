import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool.js";

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read the contents of a file at the given path",
  kind: "read",
  schema: z.object({
    path: z.string().min(1).describe("Path to the file to read"),
  }),
  async execute({ path }, ctx) {
    try {
      const content = await readFile(resolve(ctx.cwd, path), "utf8");
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to read "${path}": ${message}`, isError: true };
    }
  },
});
