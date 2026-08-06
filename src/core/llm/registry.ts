import type { LLMProvider } from "./provider.js";


export type ProviderFactory = () => LLMProvider;

const factories = new Map<string, ProviderFactory>();

export function registerProvider(id: string, factory: ProviderFactory): void {
  if (factories.has(id)) {
    throw new Error(`LLM provider "${id}" is already registered`);
  }
  factories.set(id, factory);
}

export function createProvider(id: string): LLMProvider {
  const factory = factories.get(id);
  if (!factory) {
    const available = [...factories.keys()].join(", ") || "(none registered)";
    throw new Error(`Unknown LLM provider: "${id}". Available: ${available}`);
  }
  return factory();
}

export function listProviders(): string[] {
  return [...factories.keys()];
}
