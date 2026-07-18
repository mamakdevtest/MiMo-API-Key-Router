import { describe, expect, it } from 'vitest';
import { modelBenchmarkResults, providerModels } from '../db/schema.js';
import { ProviderService } from '../providers/provider-service.js';
import { adminLogin, buildTestApp } from './helpers.js';

describe('model health admin APIs', () => {
  it('sorts catalog health before pagination and exposes consistent provider and dashboard summaries', async () => {
    const { app, db, gatewayKey } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({ type: 'openai_compatible', name: 'Health', slug: 'health', baseUrl: 'https://example.test/v1' });
    const now = new Date();
    const models = [
      ['ready-slow', 'ready-slow'],
      ['ready-fast', 'ready-fast'],
      ['limited', 'limited'],
      ['untested', 'untested'],
      ['stale', 'stale'],
      ['failed', 'failed'],
      ['inactive', 'inactive'],
    ].map(([id, upstream]) => ({
      id,
      providerId: provider.id,
      upstreamModelId: upstream,
      status: id === 'inactive' ? 'possibly_removed' : 'active',
      supportsChat: true,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(providerModels).values(models);
    await db.insert(modelBenchmarkResults).values([
      { providerModelId: 'ready-slow', outcome: 'success', latencyMs: 300, httpStatus: 200, testedAt: now },
      { providerModelId: 'ready-fast', outcome: 'success', latencyMs: 90, httpStatus: 200, testedAt: now },
      { providerModelId: 'limited', outcome: 'rate_limited', latencyMs: null, httpStatus: 429, errorMessage: 'limited', testedAt: now },
      { providerModelId: 'stale', outcome: 'success', latencyMs: 40, httpStatus: 200, testedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) },
      { providerModelId: 'failed', outcome: 'failed', latencyMs: 10, httpStatus: 503, errorMessage: 'bad gateway', testedAt: now },
    ]);
    const session = await adminLogin(app);
    const auth = { cookies: { admin_session: session }, headers: { 'x-csrf-token': session } };

    const catalog = await app.inject({ method: 'GET', url: '/admin/model-catalog?page=1&perPage=20', ...auth });
    expect(catalog.statusCode).toBe(200);
    const body = JSON.parse(catalog.payload);
    expect(body.models.map((model: { id: string }) => model.id)).toEqual(['ready-fast', 'ready-slow', 'limited', 'untested', 'stale', 'failed', 'inactive']);
    expect(body.models.map((model: { health: string }) => model.health)).toEqual(['ready', 'ready', 'rate_limited', 'untested', 'stale', 'failed', 'inactive']);
    expect(body.models[0].benchmark).toMatchObject({ latencyMs: 90, httpStatus: 200 });

    const providers = await app.inject({ method: 'GET', url: '/admin/providers', ...auth });
    const providerResponse = JSON.parse(providers.payload).find((item: { id: string }) => item.id === provider.id);
    expect(providerResponse.modelHealth).toMatchObject({ ready: 2, rate_limited: 1, untested: 1, stale: 1, failed: 1, inactive: 1, retestRecommended: 3 });
    const providerModelsResponse = await app.inject({ method: 'GET', url: `/admin/providers/${provider.id}/models?limit=20`, ...auth });
    expect(JSON.parse(providerModelsResponse.payload)[0]).toMatchObject({ id: 'ready-fast', health: 'ready', benchmark: { latencyMs: 90 } });
    const dashboard = await app.inject({ method: 'GET', url: '/admin/dashboard', ...auth });
    expect(JSON.parse(dashboard.payload).modelHealth).toMatchObject({ ready: 2, rate_limited: 1, untested: 1, stale: 1, failed: 1, inactive: 1, retestRecommended: 3 });

    // A failed benchmark remains a normal gateway model and is never hidden by health UI state.
    const publicModels = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${gatewayKey}` } });
    expect(JSON.parse(publicModels.payload).data.map((model: { id: string }) => model.id)).toContain('health/failed');
  });
});
