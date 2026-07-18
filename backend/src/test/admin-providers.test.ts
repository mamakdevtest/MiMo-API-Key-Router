import { describe, it, expect } from 'vitest';
import { buildTestApp, adminLogin } from './helpers.js';

async function authed(app: any) {
  const session = await adminLogin(app);
  return { admin_session: session, 'x-csrf-token': session, 'content-type': 'application/json' };
}

describe('Admin provider management (extended)', () => {
  it('creates an orcarouter provider', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers',
      headers,
      payload: {
        type: 'orcarouter',
        name: 'My OrcaRouter',
        slug: 'orcarouter-main',
        baseUrl: 'https://api.orcarouter.ai/v1',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.type).toBe('orcarouter');
    expect(body.authHeader).toBe('Authorization');
    expect(body.authPrefix).toBe('Bearer ');
    expect(body.chatCompletionsEndpoint).toBe('/chat/completions');
  });

  it('creates a custom openai_compatible provider with extended config', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers',
      headers,
      payload: {
        type: 'openai_compatible',
        name: 'My LLM',
        slug: 'my-llm',
        baseUrl: 'https://llm.example.com/v1',
        documentationUrl: 'https://docs.example.com',
        authHeader: 'X-API-Key',
        authPrefix: '',
        modelsEndpoint: '/v2/models',
        chatCompletionsEndpoint: '/v2/chat',
        timeoutMs: 20000,
        customHeaders: { 'X-Team': 'backend', 'X-Api-Key': 'secret-key' },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.type).toBe('openai_compatible');
    expect(body.documentationUrl).toBe('https://docs.example.com');
    expect(body.authHeader).toBe('X-API-Key');
    expect(body.modelsEndpoint).toBe('/v2/models');
    expect(body.timeoutMs).toBe(20000);
    // custom headers are masked in responses; secret-looking ones are hidden
    expect(body.customHeaders['X-Team']).toBe('backend');
    expect(body.customHeaders['X-Api-Key']).toBe('****');
    // raw encrypted JSON must never be exposed
    expect(body.customHeadersJson).toBeUndefined();
  });

  it('rejects unsupported provider types', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers',
      headers,
      payload: { type: 'openrouter', name: 'X', slug: 'x-1', baseUrl: 'https://api.example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsafe base URLs (SSRF) outside dev/test', async () => {
    // NODE_ENV=test allows private URLs; the SSRF test for production is covered
    // in url-validator.test.ts. Here we assert an invalid URL is still rejected.
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers',
      headers,
      payload: { type: 'openai_compatible', name: 'X', slug: 'x-2', baseUrl: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate slugs', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const payload = { type: 'orcarouter', name: 'A', slug: 'dup-slug', baseUrl: 'https://api.orcarouter.ai/v1' };
    await app.inject({ method: 'POST', url: '/admin/providers', headers, payload });
    const res = await app.inject({ method: 'POST', url: '/admin/providers', headers, payload });
    expect(res.statusCode).toBe(409);
  });

  it('persists provider type in list endpoint', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    await app.inject({
      method: 'POST',
      url: '/admin/providers',
      headers,
      payload: { type: 'orcarouter', name: 'Orca', slug: 'orca-list', baseUrl: 'https://api.orcarouter.ai/v1' },
    });

    const res = await app.inject({ method: 'GET', url: '/admin/providers', headers });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.payload);
    const orca = list.find((p: any) => p.slug === 'orca-list');
    expect(orca).toBeDefined();
    expect(orca.type).toBe('orcarouter');
  });

  it('validate endpoint rejects an invalid URL', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/validate',
      headers,
      payload: { baseUrl: 'not-a-url' },
    });
    // schema validation rejects non-URL
    expect(res.statusCode).toBe(400);
  });

  it('validate endpoint returns a structured result for a valid URL', async () => {
    const { app } = await buildTestApp();
    const headers = await authed(app);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/providers/validate',
      headers,
      payload: { baseUrl: 'https://unreachable-host-xyz.example/v1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty('urlSafe');
    expect(body).toHaveProperty('modelsReachable');
    expect(body).toHaveProperty('capabilities');
    expect(body).toHaveProperty('errors');
  });
});
