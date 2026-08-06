import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../tool.js";

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Edit a file by replacing an exact text fragment (old_string) with new text (new_string). " +
    "The fragment must match the file content exactly, including whitespace and indentation. " +
    "Fails if the fragment is not found or occurs more than once.",
  kind: "write",
  schema: z.object({
    path: z.string().min(1).describe("Path to the file to edit"),
    old_string: z.string().min(1).describe("Exact text to find in the file"),
    new_string: z.string().describe("Text to replace it with"),
  }),
  async execute({ path, old_string: oldString, new_string: newString }, ctx) {
    const fullPath = resolve(ctx.cwd, path);

    let content: string;
    try {
      content = await readFile(fullPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to read "${path}": ${message}`, isError: true };
    }

    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return {
        content: `old_string not found in "${path}". Make sure it matches the file content exactly.`,
        isError: true,
      };
    }
    if (occurrences > 1) {
      return {
        content: `old_string occurs ${occurrences} times in "${path}". Provide a larger, unique fragment.`,
        isError: true,
      };
    }

    try {
      await writeFile(fullPath, content.replace(oldString, newString), "utf8");
      return { content: `Edited "${path}": replaced ${oldString.length} chars with ${newString.length} chars` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to write "${path}": ${message}`, isError: true };
    }
  },
});
