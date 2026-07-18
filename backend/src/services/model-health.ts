import type { ModelBenchmarkResultRecord } from '../db/schema.js';

export const MODEL_BENCHMARK_STALE_MS = 24 * 60 * 60 * 1000;

export type ModelHealth = 'ready' | 'rate_limited' | 'untested' | 'stale' | 'failed' | 'inactive';
export type ModelBenchmarkSnapshot = Pick<ModelBenchmarkResultRecord, 'outcome' | 'latencyMs' | 'httpStatus' | 'errorMessage' | 'testedAt'>;

export type ModelHealthSummary = Record<ModelHealth, number> & {
  total: number;
  retestRecommended: number;
};

export function getModelHealth(
  input: {
    providerEnabled: boolean;
    modelStatus: string;
    benchmark: ModelBenchmarkSnapshot | null;
  },
  now = new Date(),
): ModelHealth {
  if (!input.providerEnabled || input.modelStatus !== 'active') return 'inactive';
  if (!input.benchmark) return 'untested';
  if (now.getTime() - input.benchmark.testedAt.getTime() >= MODEL_BENCHMARK_STALE_MS) return 'stale';

  switch (input.benchmark.outcome) {
    case 'success': return 'ready';
    case 'rate_limited': return 'rate_limited';
    default: return 'failed';
  }
}

export function getModelHealthRank(health: ModelHealth): number {
  return ['ready', 'rate_limited', 'untested', 'stale', 'failed', 'inactive'].indexOf(health);
}

export function serializeBenchmark(benchmark: ModelBenchmarkSnapshot | null) {
  if (!benchmark) return null;
  return {
    outcome: benchmark.outcome,
    latencyMs: benchmark.latencyMs,
    httpStatus: benchmark.httpStatus,
    errorMessage: benchmark.errorMessage,
    testedAt: benchmark.testedAt.toISOString(),
  };
}

export function compareModelHealth<T extends {
  health: ModelHealth;
  benchmark: ModelBenchmarkSnapshot | null;
  providerPriority: number;
  upstreamModelId: string;
}>(a: T, b: T): number {
  const health = getModelHealthRank(a.health) - getModelHealthRank(b.health);
  if (health !== 0) return health;

  const aLatency = a.benchmark?.latencyMs ?? Number.MAX_SAFE_INTEGER;
  const bLatency = b.benchmark?.latencyMs ?? Number.MAX_SAFE_INTEGER;
  if (aLatency !== bLatency) return aLatency - bLatency;
  if (a.providerPriority !== b.providerPriority) return a.providerPriority - b.providerPriority;
  return a.upstreamModelId.localeCompare(b.upstreamModelId);
}

export function summarizeModelHealth(healths: Iterable<ModelHealth>): ModelHealthSummary {
  const summary: ModelHealthSummary = {
    ready: 0,
    rate_limited: 0,
    untested: 0,
    stale: 0,
    failed: 0,
    inactive: 0,
    total: 0,
    retestRecommended: 0,
  };
  for (const health of healths) {
    summary[health] += 1;
    summary.total += 1;
    if (health === 'untested' || health === 'stale' || health === 'failed') summary.retestRecommended += 1;
  }
  return summary;
}
