import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description: "Write content to a file at the given path (creates or overwrites)",
  kind: "write",
  schema: z.object({
    path: z.string().min(1).describe("Path to the file to write"),
    content: z.string().describe("Content to write into the file"),
  }),
  async execute({ path, content }, ctx) {
    const fullPath = resolve(ctx.cwd, path);
    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
      return { content: `Wrote ${content.length} characters to "${path}"` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to write "${path}": ${message}`, isError: true };
    }
  },
});
