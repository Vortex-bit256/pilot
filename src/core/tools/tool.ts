import { z } from "zod";
import type { ToolResult } from "../../protocol/index.js";
import type { ToolContext } from "./context.js";


export type ToolKind = "read" | "write" | "exec";


export interface ToolDefinition {
  name: string;
  description: string;

  inputSchema: Record<string, unknown>;
  kind: ToolKind;
}


export interface Tool<S extends z.ZodType = z.ZodType> {
  definition: ToolDefinition;
  schema: S;
  execute(input: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
}


export type AnyTool = Tool<any>;


export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(options: {
  name: string;
  description: string;
  kind: ToolKind;
  schema: S;
  execute(input: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
}): Tool<S> {
  return {
    definition: {
      name: options.name,
      description: options.description,
      kind: options.kind,
      inputSchema: toJsonSchema(options.schema),
    },
    schema: options.schema,
    execute: options.execute,
  };
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  delete jsonSchema.$schema;
  return jsonSchema;
}
