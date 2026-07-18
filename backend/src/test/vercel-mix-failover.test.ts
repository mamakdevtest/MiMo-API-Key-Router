import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelRoutes, modelRouteTargets, providerModels } from '../db/schema.js';
import { ProviderService } from '../providers/provider-service.js';
import { buildTestApp } from './helpers.js';

const originalFetch = global.fetch;

describe('Vercel mix failover', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('tries every key twice for a rate-limited model before using the next mix target', async () => {
    const { app, db, gatewayKey } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({
      type: 'openai_compatible',
      name: 'Vercel',
      slug: 'vercel',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
    });
    await providerService.createCredential(provider.id, { name: 'Vercel key 1', secret: 'key-one', priority: 0 });
    await providerService.createCredential(provider.id, { name: 'Vercel key 2', secret: 'key-two', priority: 1 });

    const now = new Date();
    await db.insert(providerModels).values([
      { id: 'vercel-model-one', providerId: provider.id, upstreamModelId: 'model-one', supportsChat: true, createdAt: now, updatedAt: now },
      { id: 'vercel-model-two', providerId: provider.id, upstreamModelId: 'model-two', supportsChat: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(modelRoutes).values({
      id: 'vercel-mix',
      publicModelId: 'vercel.mix.router',
      routeKind: 'chat',
      strategy: 'priority_failover',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(modelRouteTargets).values([
      { id: 'vercel-target-one', routeId: 'vercel-mix', providerId: provider.id, providerModelId: 'vercel-model-one', priority: 0, createdAt: now, updatedAt: now },
      { id: 'vercel-target-two', routeId: 'vercel-mix', providerId: provider.id, providerModelId: 'vercel-model-two', priority: 1, createdAt: now, updatedAt: now },
    ]);

    const rateLimited = new Response(JSON.stringify({ error: { message: 'Free tier requests on this model are rate-limited.' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(rateLimited.clone())
      .mockResolvedValueOnce(rateLimited.clone())
      .mockResolvedValueOnce(rateLimited.clone())
      .mockResolvedValueOnce(rateLimited.clone())
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-ok', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'vercel.mix.router', messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(5);
    const attemptedModels = vi.mocked(global.fetch).mock.calls.map(([, options]) => JSON.parse((options as RequestInit).body as string).model);
    expect(attemptedModels).toEqual(['model-one', 'model-one', 'model-one', 'model-one', 'model-two']);
    expect((await providerService.listCredentials(provider.id)).map((credential) => credential.status)).toEqual(['active', 'active']);
  });
});
