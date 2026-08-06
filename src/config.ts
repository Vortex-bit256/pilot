import { existsSync } from "node:fs";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxIterations: number;
  debug: boolean;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";


function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export function loadConfig(): AppConfig {
  loadDotEnv();

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set.\n" +
        "  1. Copy .env.example to .env and put your key there, or\n" +
        "  2. export DEEPSEEK_API_KEY=<your-key>",
    );
  }

  const rawMaxIterations = process.env.AGENT_MAX_ITERATIONS ?? "20";
  const maxIterations = Number(rawMaxIterations);
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(
      `AGENT_MAX_ITERATIONS must be a positive integer, got: "${rawMaxIterations}"`,
    );
  }

  const debugEnv = process.env.AGENT_DEBUG?.trim().toLowerCase();

  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
    model: process.env.AGENT_MODEL ?? DEFAULT_MODEL,
    maxIterations,
    debug: debugEnv === "1" || debugEnv === "true",
  };
}
