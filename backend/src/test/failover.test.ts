import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, adminLogin } from './helpers.js';

const originalFetch = global.fetch;

describe('Failover, low-credit detection & token counting', () => {
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

  async function getKeys(app: FastifyInstance) {
    const session = await adminLogin(app);
    const keysRes = await app.inject({
      method: 'GET',
      url: '/admin/keys',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    return JSON.parse(keysRes.payload);
  }

  async function getLogs(app: FastifyInstance) {
    const session = await adminLogin(app);
    const logsRes = await app.inject({
      method: 'GET',
      url: '/admin/logs?limit=100',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    return JSON.parse(logsRes.payload);
  }

  async function getUsage(app: FastifyInstance) {
    const session = await adminLogin(app);
    const usageRes = await app.inject({
      method: 'GET',
      url: '/admin/usage?period=24h',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    return JSON.parse(usageRes.payload);
  }

  // ── Low Credit Body Detection ─────────────────────────────

  it('detects "low credit" in response body and marks key exhausted', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Your account has low credit balance' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-ok', choices: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);

    const keys = await getKeys(app);
    expect(keys[0].status).toBe('exhausted');
    expect(keys[1].status).toBe('active');
  });

  it('detects "insufficient balance" in response body', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Insufficient balance for this request' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    const keys = await getKeys(app);
    expect(keys[0].status).toBe('exhausted');
  });

  it('detects "quota exceeded" in response body', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'You have exceeded your current quota' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    const keys = await getKeys(app);
    expect(keys[0].status).toBe('exhausted');
  });

  // ── Token/Cost Counting ───────────────────────────────────

  it('correctly counts OpenAI usage format', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [], usage }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    const logs = await getLogs(app);
    const log = logs[0];
    expect(log.promptTokens).toBe(100);
    expect(log.completionTokens).toBe(50);
    expect(log.totalTokens).toBe(150);
    expect(log.estimatedCost).toBeGreaterThan(0);
  });

  it('correctly counts Anthropic usage format (input_tokens/output_tokens)', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    const usage = { input_tokens: 200, output_tokens: 80 };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg_1', content: [], usage }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    const logs = await getLogs(app);
    const log = logs[0];
    expect(log.promptTokens).toBe(200);
    expect(log.completionTokens).toBe(80);
    expect(log.totalTokens).toBe(280);
  });

  it('does NOT write token/cost for failed attempts — only for success', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Payment required', { status: 402 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chatcmpl-ok', usage }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    const logs = await getLogs(app);
    // Should only have ONE log entry for the successful request
    expect(logs.length).toBe(1);
    const log = logs[0];
    expect(log.statusCode).toBe(200);
    expect(log.promptTokens).toBe(100);
    expect(log.completionTokens).toBe(50);
    expect(log.totalTokens).toBe(150);
  });

  it('does not write tokens when usage is missing from response', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    // Response without usage field
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    const logs = await getLogs(app);
    expect(logs[0].promptTokens).toBe(0);
    expect(logs[0].completionTokens).toBe(0);
    expect(logs[0].totalTokens).toBe(0);
    expect(logs[0].estimatedCost).toBe(0);
  });

  // ── Dashboard Consistency ─────────────────────────────────

  it('dashboard stats match database totals', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);

    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-1', usage }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    const usageData = await getUsage(app);
    expect(usageData.totals.requests).toBe(1);
    expect(usageData.totals.tokens).toBe(150);
    expect(usageData.totals.cost).toBeGreaterThan(0);
  });

  // ── All keys fail ─────────────────────────────────────────

  it('returns 503 with descriptive error when all keys are exhausted', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Payment required', { status: 402 }))
      .mockResolvedValueOnce(new Response('Payment required', { status: 402 }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Service Unavailable');
    expect(body.message).toContain('No available API keys');
  });

  // ── Exhausted keys should not be selected ─────────────────

  it('does not select exhausted keys for new requests', async () => {
    const { app, gatewayKey } = await buildTestApp();
    await addKey(app, 'Key 1', 'sk-key1', 0);
    await addKey(app, 'Key 2', 'sk-key2', 1);

    // First request: key 1 gets exhausted, key 2 succeeds
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('Payment required', { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chatcmpl-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] },
    });

    // Second request: key 1 should NOT be tried again (it's exhausted)
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'chatcmpl-2' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${gatewayKey}`, 'content-type': 'application/json' },
      payload: { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res2.statusCode).toBe(200);
    // Key 1 should not have been called — only key 2
    const lastCall = vi.mocked(global.fetch).mock.calls[2][1] as RequestInit;
    expect(lastCall.headers).toMatchObject({ Authorization: 'Bearer sk-key2' });
  });
});
