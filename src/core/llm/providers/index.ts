import { registerProvider } from "../registry.js";
import { createDeepSeekProvider } from "./deepseek.js";

let registered = false;


export function registerBuiltinProviders(): void {
  if (registered) {
    return;
  }
  registerProvider("deepseek", createDeepSeekProvider);
  registered = true;
}
