import { describe, expect, it } from 'vitest';
import { classifyHttpError } from '../routing/error-classifier.js';

describe('Vercel free-tier rate-limit classification', () => {
  it('uses credential failover without cooling down or exhausting the key', () => {
    const error = classifyHttpError(429, {
      error: { message: 'Free tier requests on this model are rate-limited.' },
    }, 'openai_compatible');

    expect(error.category).toBe('vercel_free_tier_model_rate_limited');
    expect(error.scope).toBe('credential');
    expect(error.action).toBe('next_credential');
    expect(error.cooldownMs).toBeUndefined();
  });
});
