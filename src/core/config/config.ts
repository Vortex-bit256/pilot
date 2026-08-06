import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const CONFIG_FILE = "agent.config.json";


const configSchema = z.object({

  provider: z.string().min(1).default("deepseek"),
  model: z.string().min(1).default("deepseek-chat"),
  maxIterations: z.coerce.number().int().positive().default(20),
  debug: z.boolean().default(false),
});

export type AppConfig = z.output<typeof configSchema>;


export type ConfigLayer = Partial<Record<keyof AppConfig, unknown>>;


function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}


function fileLayer(path = CONFIG_FILE): ConfigLayer {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("expected a JSON object at the top level");
    }
    return parsed as ConfigLayer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${path}: ${message}`);
  }
}


function envLayer(env: NodeJS.ProcessEnv = process.env): ConfigLayer {
  const layer: ConfigLayer = {};
  if (env.AGENT_PROVIDER?.trim()) layer.provider = env.AGENT_PROVIDER.trim();
  if (env.AGENT_MODEL?.trim()) layer.model = env.AGENT_MODEL.trim();

  if (env.AGENT_MAX_ITERATIONS?.trim()) layer.maxIterations = env.AGENT_MAX_ITERATIONS.trim();
  const debug = env.AGENT_DEBUG?.trim().toLowerCase();
  if (debug) layer.debug = debug === "1" || debug === "true";
  return layer;
}


export function loadConfig(cliOverrides: ConfigLayer = {}): AppConfig {
  loadDotEnv();
  const merged: ConfigLayer = { ...fileLayer(), ...envLayer(), ...cliOverrides };
  const result = configSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
