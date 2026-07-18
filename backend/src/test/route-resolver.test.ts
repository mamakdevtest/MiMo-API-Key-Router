import { describe, expect, it } from 'vitest';
import { modelRoutes, modelRouteTargets, providerModels, providers } from '../db/schema.js';
import { RouteResolver } from '../routing/route-resolver.js';
import { buildTestApp } from './helpers.js';

describe('RouteResolver configured mix routes', () => {
  it('resolves configured targets in priority order', async () => {
    const { db } = await buildTestApp();
    const now = new Date();

    await db.insert(providers).values({
      id: 'provider-vercel',
      type: 'openai_compatible',
      name: 'Vercel',
      slug: 'vercel',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(providerModels).values([
      { id: 'model-first', providerId: 'provider-vercel', upstreamModelId: 'first-model', supportsChat: true, createdAt: now, updatedAt: now },
      { id: 'model-second', providerId: 'provider-vercel', upstreamModelId: 'second-model', supportsChat: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(modelRoutes).values({
      id: 'route-mix',
      publicModelId: 'vercel.mix.router',
      routeKind: 'chat',
      strategy: 'priority_failover',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(modelRouteTargets).values([
      { id: 'target-first', routeId: 'route-mix', providerId: 'provider-vercel', providerModelId: 'model-first', priority: 0, createdAt: now, updatedAt: now },
      { id: 'target-second', routeId: 'route-mix', providerId: 'provider-vercel', providerModelId: 'model-second', priority: 1, createdAt: now, updatedAt: now },
    ]);

    const resolved = await new RouteResolver(db).resolve('vercel.mix.router');

    expect(resolved?.strategy).toBe('priority_failover');
    expect(resolved?.targets.map((target) => target.upstreamModelId)).toEqual(['first-model', 'second-model']);
    expect((await new RouteResolver(db).getPublicRoutes()).map((route) => route.publicModelId)).toContain('vercel.mix.router');
  });
});
