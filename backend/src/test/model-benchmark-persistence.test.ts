import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { modelBenchmarkResults, providerModels } from '../db/schema.js';
import { ProviderService } from '../providers/provider-service.js';
import { ModelBenchmarkService } from '../services/model-benchmark-service.js';
import { streamManager } from '../services/stream-manager.js';
import { buildTestApp } from './helpers.js';

const originalFetch = global.fetch;

describe('benchmark persistence', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it('atomically replaces the one saved result with success, rate-limit, and failure outcomes', async () => {
    const { db } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({
      type: 'openai_compatible', name: 'Vercel', slug: 'vercel-health', baseUrl: 'https://ai-gateway.vercel.sh/v1',
    });
    await providerService.createCredential(provider.id, { name: 'primary', secret: 'secret', priority: 0 });
    const now = new Date();
    await db.insert(providerModels).values({
      id: 'health-model', providerId: provider.id, upstreamModelId: 'model-health', supportsChat: true, createdAt: now, updatedAt: now,
    });
    const benchmark = new ModelBenchmarkService(db);
    const broadcast = vi.spyOn(streamManager, 'broadcast');

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await benchmark.benchmark(provider.id, ['model-health']);
    let rows = await db.select().from(modelBenchmarkResults).where(eq(modelBenchmarkResults.providerModelId, 'health-model'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'success', httpStatus: 200 });

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Free tier requests on this model are rate-limited.' } }), { status: 429 }));
    await benchmark.benchmark(provider.id, ['model-health']);
    rows = await db.select().from(modelBenchmarkResults).where(eq(modelBenchmarkResults.providerModelId, 'health-model'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'rate_limited', httpStatus: 429, latencyMs: null });

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }));
    await benchmark.benchmark(provider.id, ['model-health']);
    rows = await db.select().from(modelBenchmarkResults).where(eq(modelBenchmarkResults.providerModelId, 'health-model'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'failed', httpStatus: 503 });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'benchmark_started', flowType: 'benchmark' }));
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'benchmark_completed', flowType: 'benchmark', success: false }));
  });

  it('persists only a completed sequential result and skips a model cancelled in flight', async () => {
    const { db } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({
      type: 'openai_compatible', name: 'Sequential', slug: 'sequential-health', baseUrl: 'https://example.test/v1',
    });
    await providerService.createCredential(provider.id, { name: 'primary', secret: 'secret', priority: 0 });
    const now = new Date();
    await db.insert(providerModels).values([
      { id: 'sequential-complete', providerId: provider.id, upstreamModelId: 'complete', supportsChat: true, createdAt: now, updatedAt: now },
      { id: 'sequential-cancelled', providerId: provider.id, upstreamModelId: 'cancelled', supportsChat: true, createdAt: now, updatedAt: now },
    ]);

    let resolveFetch: ((response: Response) => void) | undefined;
    vi.mocked(global.fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const benchmark = new ModelBenchmarkService(db);
    const job = benchmark.startSequentialAll(provider.id);
    await waitFor(() => !!resolveFetch);
    benchmark.cancelJob(job.id);
    resolveFetch!(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await waitFor(() => job.status === 'cancelled');
    expect(await db.select().from(modelBenchmarkResults)).toEqual([]);

    vi.mocked(global.fetch).mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    const completed = benchmark.startSequentialAll(provider.id);
    await waitFor(() => completed.status === 'completed');
    const results = await db.select().from(modelBenchmarkResults);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.outcome === 'success')).toBe(true);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for benchmark job');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
