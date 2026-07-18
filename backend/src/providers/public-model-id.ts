import type { ProviderInstance } from './types.js';

export function buildPublicModelId(provider: Pick<ProviderInstance, 'slug'>, upstreamModelId: string): string {
  return `${provider.slug}/${upstreamModelId}`;
}

export function splitPublicModelId(modelId: string): { providerSlug: string; upstreamModelId: string } | null {
  const slashIndex = modelId.indexOf('/');
  if (slashIndex <= 0 || slashIndex === modelId.length - 1) return null;

  return {
    providerSlug: modelId.slice(0, slashIndex),
    upstreamModelId: modelId.slice(slashIndex + 1),
  };
}
