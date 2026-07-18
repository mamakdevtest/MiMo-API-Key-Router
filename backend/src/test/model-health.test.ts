import { describe, expect, it } from 'vitest';
import { MODEL_BENCHMARK_STALE_MS, getModelHealth, getModelHealthRank, summarizeModelHealth, type ModelHealth } from '../services/model-health.js';

const now = new Date('2026-07-18T12:00:00.000Z');
const freshSuccess = {
  outcome: 'success' as const,
  latencyMs: 120,
  httpStatus: 200,
  errorMessage: null,
  testedAt: new Date(now.getTime() - 1_000),
};

describe('model health', () => {
  it('derives all UI-only health states, including the 24-hour stale threshold', () => {
    const base = { providerEnabled: true, modelStatus: 'active' };
    expect(getModelHealth({ ...base, benchmark: freshSuccess }, now)).toBe('ready');
    expect(getModelHealth({ ...base, benchmark: { ...freshSuccess, outcome: 'rate_limited', httpStatus: 429 } }, now)).toBe('rate_limited');
    expect(getModelHealth({ ...base, benchmark: null }, now)).toBe('untested');
    expect(getModelHealth({ ...base, benchmark: { ...freshSuccess, testedAt: new Date(now.getTime() - MODEL_BENCHMARK_STALE_MS) } }, now)).toBe('stale');
    expect(getModelHealth({ ...base, benchmark: { ...freshSuccess, outcome: 'failed', httpStatus: 500 } }, now)).toBe('failed');
    expect(getModelHealth({ ...base, providerEnabled: false, benchmark: freshSuccess }, now)).toBe('inactive');
    expect(getModelHealth({ ...base, modelStatus: 'possibly_removed', benchmark: freshSuccess }, now)).toBe('inactive');
  });

  it('uses the documented health ordering and retest count', () => {
    const ordered: ModelHealth[] = ['ready', 'rate_limited', 'untested', 'stale', 'failed', 'inactive'];
    expect(ordered.map(getModelHealthRank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(summarizeModelHealth(['ready', 'untested', 'stale', 'failed', 'inactive'])).toMatchObject({
      ready: 1,
      untested: 1,
      stale: 1,
      failed: 1,
      inactive: 1,
      total: 5,
      retestRecommended: 3,
    });
  });
});
