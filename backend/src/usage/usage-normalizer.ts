/**
 * Usage extraction and cost calculation utilities.
 * Handles both OpenAI and Anthropic usage formats.
 */

import type { NormalizedUsage } from '../providers/types.js';

export function extractTokenUsage(body: unknown): NormalizedUsage {
  const empty: NormalizedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };
  if (!body || typeof body !== 'object') return empty;
  const obj = body as Record<string, unknown>;
  if (!obj.usage || typeof obj.usage !== 'object') return empty;
  const usage = obj.usage as Record<string, unknown>;

  // OpenAI: prompt_tokens / completion_tokens / total_tokens
  // Anthropic: input_tokens / output_tokens
  const inputTokens = (usage.prompt_tokens as number) || (usage.input_tokens as number) || 0;
  const outputTokens = (usage.completion_tokens as number) || (usage.output_tokens as number) || 0;
  const totalTokens = (usage.total_tokens as number) || (inputTokens + outputTokens);

  // Cached tokens
  let cachedInputTokens = 0;
  if (typeof usage.cache_read_input_tokens === 'number') {
    cachedInputTokens = usage.cache_read_input_tokens;
  } else if (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object') {
    const details = usage.prompt_tokens_details as Record<string, unknown>;
    if (typeof details.cached_tokens === 'number') {
      cachedInputTokens = details.cached_tokens;
    }
  }

  return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number, pricingOverride?: { input: number; output: number }): number {
  if (pricingOverride) {
    const inputCost = (inputTokens / 1_000_000) * pricingOverride.input;
    const outputCost = (outputTokens / 1_000_000) * pricingOverride.output;
    return Math.round((inputCost + outputCost) * 100_000_000) / 100_000_000;
  }

  // Default MiMo pricing
  const PRICING: Record<string, { input: number; output: number }> = {
    'mimo-v2.5-pro': { input: 0.435, output: 0.87 },
    'mimo-v2.5': { input: 0.14, output: 0.28 },
    'mimo-v2.5-asr': { input: 0.074, output: 0 },
  };

  const normalized = model.toLowerCase();
  const pricing = PRICING[normalized] || PRICING[normalized.split('/').pop() || ''] || (normalized.includes('mimo') ? PRICING['mimo-v2.5'] : undefined);

  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 100_000_000) / 100_000_000;
}

export function calculateCostFromPricing(
  inputTokens: number,
  outputTokens: number,
  pricing: { prompt: string | null; completion: string | null; request: string | null },
): number {
  const inputPrice = pricing.prompt ? parseFloat(pricing.prompt) : 0;
  const outputPrice = pricing.completion ? parseFloat(pricing.completion) : 0;
  const requestPrice = pricing.request ? parseFloat(pricing.request) : 0;

  const inputCost = (inputTokens / 1_000_000) * inputPrice;
  const outputCost = (outputTokens / 1_000_000) * outputPrice;

  return Math.round((inputCost + outputCost + requestPrice) * 100_000_000) / 100_000_000;
}
