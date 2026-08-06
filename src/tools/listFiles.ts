import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool } from "./types.js";

const MAX_ENTRIES = 500;
const IGNORED = new Set(["node_modules", ".git", "dist"]);

export const listFilesTool: Tool = {
  definition: {
    name: "list_files",
    description:
      "List files and directories at the given path. Use recursive=true to list the whole subtree.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list (default: current directory)" },
        recursive: {
          type: "boolean",
          description: "List subdirectories recursively (default: false)",
        },
      },
    },
  },
  async execute(input) {
    const root = String(input.path ?? ".") || ".";
    const recursive = input.recursive === true;

    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        return { content: `Not a directory: "${root}"`, isError: true };
      }

      const entries: string[] = [];
      await collect(root, recursive, entries);

      if (entries.length === 0) {
        return { content: "(empty directory)" };
      }
      const truncated = entries.length >= MAX_ENTRIES;
      return {
        content: entries.join("\n") + (truncated ? `\n... (truncated at ${MAX_ENTRIES} entries)` : ""),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Failed to list "${root}": ${message}`, isError: true };
    }

    async function collect(dir: string, deep: boolean, out: string[]): Promise<void> {
      if (out.length >= MAX_ENTRIES) return;
      const items = await readdir(dir, { withFileTypes: true });
      items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

      for (const item of items) {
        if (out.length >= MAX_ENTRIES) return;
        if (IGNORED.has(item.name)) continue;
        const full = join(dir, item.name);
        out.push(relative(root, full) + (item.isDirectory() ? "/" : ""));
        if (deep && item.isDirectory()) {
          await collect(full, true, out);
        }
      }
    }
  },
};
