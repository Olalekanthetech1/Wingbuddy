import { AsyncLocalStorage } from "node:async_hooks";
import type { AIProviderId } from "./ai-provider.types";

interface ProviderKeyContext { keys: Partial<Record<AIProviderId, string>>; }
const storage = new AsyncLocalStorage<ProviderKeyContext>();

export async function withProviderApiKey<T>(provider: AIProviderId, key: string, fn: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  const keys = { ...(current?.keys || {}), [provider]: key };
  return storage.run({ keys }, fn);
}

export function getRequestScopedProviderApiKey(provider: AIProviderId): string | undefined {
  return storage.getStore()?.keys[provider];
}