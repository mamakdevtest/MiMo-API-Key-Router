import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, adminLogin } from './helpers.js';

const originalFetch = global.fetch;

describe('Key routing and failover', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function addKey(app: FastifyInstance, label: string, key: string, priority: number) {
    const session = await adminLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/keys',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session, 'content-type': 'application/json' },
      payload: { label, key, priority },
    });
    expect(res.statusCode).toBe(201);
  }

  it('uses key #1 when it succeeds', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    const req = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    expect(req.headers).toMatchObject({ Authorization: 'Bearer sk-key1' });
  });

  it('marks key exhausted on 402 and tries key #2', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Payment required', { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-2' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);

    const session = await adminLogin(app);
    const keysRes = await app.inject({
      method: 'GET',
      url: '/admin/keys',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    const keys = JSON.parse(keysRes.payload);
    expect(keys[0].status).toBe('exhausted');
    expect(keys[1].status).toBe('active');
  });

  it('puts key on cooldown on 429 and tries key #2', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-2' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);

    const session = await adminLogin(app);
    const keysRes = await app.inject({
      method: 'GET',
      url: '/admin/keys',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    const keys = JSON.parse(keysRes.payload);
    expect(keys[0].status).toBe('cooldown');
    expect(keys[0].cooldownUntil).not.toBeNull();
  });

  it('marks key invalid on 401 and does not retry it', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-2' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);

    const session = await adminLogin(app);
    const keysRes = await app.inject({
      method: 'GET',
      url: '/admin/keys',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    const keys = JSON.parse(keysRes.payload);
    expect(keys[0].status).toBe('invalid');
  });

  it('returns 503 when all keys fail', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    vi.mocked(global.fetch).mockResolvedValue(new Response('Server error', { status: 500 }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(503);
  });
});
