import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./types.js";

export const editFileTool: Tool = {
  definition: {
    name: "edit_file",
    description:
      "Edit a file by replacing an exact text fragment (old_string) with new text (new_string). " +
      "The fragment must match the file content exactly, including whitespace and indentation. " +
      "Fails if the fragment is not found or occurs more than once.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit" },
        old_string: { type: "string", description: "Exact text to find in the file" },
        new_string: { type: "string", description: "Text to replace it with" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  async execute(input) {
    const path = String(input.path ?? "");
    if (!path) {
      return { content: "Missing required parameter: path", isError: true };
    }
    if (typeof input.old_string !== "string" || input.old_string === "") {
      return { content: "Missing required parameter: old_string", isError: true };
    }
    if (typeof input.new_string !== "string") {
      return { content: "Missing required parameter: new_string", isError: true };
    }
    const oldString = input.old_string;
    const newString = input.new_string;

    let content: string;
    try {
      content = await readFile(path, "utf8");
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
      await writeFile(path, content.replace(oldString, newString), "utf8");
      return { content: `Edited "${path}": replaced ${oldString.length} chars with ${newString.length} chars` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to write "${path}": ${message}`, isError: true };
    }
  },
};
