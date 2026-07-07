import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, adminLogin } from './helpers.js';

const originalFetch = global.fetch;

describe('Proxy endpoints', () => {
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

  it('returns public models for Open WebUI', async () => {
    const { app, gatewayKey } = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${gatewayKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['mimo-v2.5', 'mimo-v2.5-pro']);
  });

  it('proxies Anthropic messages with allowed headers', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg_1', content: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        authorization: `Bearer ${gatewayKey}`,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-claude-code-build': '123',
        'x-api-key': 'should-be-removed',
      },
      payload: { model: 'mimo-v2.5-pro', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    const req = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const headers = req.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['x-claude-code-build']).toBe('123');
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer sk-key1');
  });

  it('proxies OpenAI chat completions', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }], stream: false },
    });

    expect(res.statusCode).toBe(200);
    const req = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const headers = req.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-key1');
  });
});
