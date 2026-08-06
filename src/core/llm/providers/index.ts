import { registerProvider } from "../registry.js";
import { createDeepSeekProvider } from "./deepseek.js";


export function registerBuiltinProviders(): void {
  registerProvider("deepseek", createDeepSeekProvider);
}
