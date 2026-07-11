/**
 * Provider adapter registry.
 *
 * Each provider type registers its adapter once at startup.
 * The registry is the single source of truth for provider capabilities.
 */

import type { ProviderAdapter, ProviderType } from './types.js';

const adapters = new Map<ProviderType, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: ProviderType): ProviderAdapter {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`No adapter registered for provider type: ${type}`);
  }
  return adapter;
}

export function getAdapterSafe(type: ProviderType): ProviderAdapter | undefined {
  return adapters.get(type);
}

export function getAllAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}

export function getRegisteredTypes(): ProviderType[] {
  return [...adapters.keys()];
}
