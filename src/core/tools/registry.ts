import { z } from "zod";
import type { ToolCall, ToolResult } from "../../protocol/index.js";
import type { ToolContext } from "./context.js";
import type { AnyTool, ToolDefinition } from "./tool.js";


export type ToolSource = { type: "builtin" } | { type: "mcp"; server: string };

export interface RegisteredTool {
  tool: AnyTool;
  source: ToolSource;

  qualifiedName: string;
}


export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: AnyTool, source: ToolSource = { type: "builtin" }): void {
    const qualifiedName = qualify(tool.definition.name, source);
    if (this.tools.has(qualifiedName)) {
      throw new Error(`Tool name conflict: "${qualifiedName}" is already registered`);
    }
    this.tools.set(qualifiedName, { tool, source, qualifiedName });
  }

  registerAll(tools: AnyTool[], source: ToolSource = { type: "builtin" }): void {
    for (const tool of tools) {
      this.register(tool, source);
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }


  definitions(): ToolDefinition[] {
    return this.list().map((r) => ({ ...r.tool.definition, name: r.qualifiedName }));
  }


  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(call.name);
    if (!entry) {
      return { content: `Unknown tool: ${call.name}`, isError: true };
    }

    const parsed = entry.tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return {
        content: `Invalid input for tool "${call.name}":\n${z.prettifyError(parsed.error)}`,
        isError: true,
      };
    }

    try {
      return await entry.tool.execute(parsed.data, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Tool "${call.name}" crashed: ${message}`, isError: true };
    }
  }
}

function qualify(name: string, source: ToolSource): string {
  return source.type === "mcp" ? `mcp__${source.server}__${name}` : name;
}
