import type { Tool, ToolDefinition, ToolResult } from "./types.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { listFilesTool } from "./listFiles.js";
import { runCommandTool } from "./runCommand.js";

export const tools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  runCommandTool,
];

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((tool) => tool.definition);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }
  try {
    return await tool.execute(input);
  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);
    return { content: `Tool "${name}" crashed: ${message}`, isError: true };
  }
}
