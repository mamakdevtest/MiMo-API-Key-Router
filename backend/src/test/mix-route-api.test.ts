import { describe, expect, it } from 'vitest';
import { providerModels } from '../db/schema.js';
import { ProviderService } from '../providers/provider-service.js';
import { RouteResolver } from '../routing/route-resolver.js';
import { adminLogin, buildTestApp } from './helpers.js';

describe('Model Catalog mix-route API', () => {
  it('accepts catalog model IDs without a model or alias count limit', async () => {
    const { app, db } = await buildTestApp();
    const provider = await new ProviderService(db).create({
      type: 'openai_compatible', name: 'Vercel', slug: 'vercel-catalog', baseUrl: 'https://ai-gateway.vercel.sh/v1',
    });
    const now = new Date();
    const models = Array.from({ length: 11 }, (_, index) => ({
      id: `catalog-model-${index}`,
      providerId: provider.id,
      upstreamModelId: `model-${index}`,
      supportsChat: true,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(providerModels).values(models);
    const session = await adminLogin(app);
    const headers = { 'x-csrf-token': session, 'content-type': 'application/json' };
    const payload = { publicModelId: 'vercel.mix.router', providerModelIds: models.map((model) => model.id) };

    const first = await app.inject({ method: 'POST', url: '/admin/mix-routes', headers, cookies: { admin_session: session }, payload });
    expect(first.statusCode).toBe(201);
    expect(JSON.parse(first.payload).targets).toHaveLength(11);
    expect(JSON.parse(first.payload).targetDetails[0]).toMatchObject({ health: 'untested', benchmark: null });

    const second = await app.inject({
      method: 'POST', url: '/admin/mix-routes', headers, cookies: { admin_session: session },
      payload: { ...payload, publicModelId: 'vercel.mix.router.secondary' },
    });
    expect(second.statusCode).toBe(201);
    expect((await new RouteResolver(db).resolve('vercel.mix.router'))?.targets).toHaveLength(11);
    expect((await new RouteResolver(db).resolve('vercel.mix.router.secondary'))?.targets).toHaveLength(11);

    const list = await app.inject({ method: 'GET', url: '/admin/mix-routes', headers, cookies: { admin_session: session } });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ publicModelId: 'vercel.mix.router', targets: expect.arrayContaining([expect.objectContaining({ providerModelId: 'catalog-model-0' })]) }),
      expect.objectContaining({ publicModelId: 'vercel.mix.router.secondary' }),
    ]));
    const firstRoute = JSON.parse(list.payload).find((route: { publicModelId: string }) => route.publicModelId === 'vercel.mix.router');
    expect(firstRoute.targets[0]).toMatchObject({ health: 'untested', benchmark: null, priority: 0 });
  });
});
