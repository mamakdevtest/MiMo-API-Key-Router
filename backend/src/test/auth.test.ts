import { describe, it, expect } from 'vitest';
import { buildTestApp, adminLogin } from './helpers.js';

describe('Authentication', () => {
  it('rejects requests without gateway key', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with wrong gateway key', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows requests with valid gateway key', async () => {
    const { app, gatewayKey } = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${gatewayKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(2);
  });

  it('blocks disallowed IP when allowlist is active', async () => {
    const { app, db, gatewayKey } = await buildTestApp();
    const session = await adminLogin(app);
    await app.inject({
      method: 'PATCH',
      url: '/admin/settings',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session, 'content-type': 'application/json' },
      payload: { ipAllowlist: '192.168.1.50' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${gatewayKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows request from allowed IP', async () => {
    const { app, gatewayKey } = await buildTestApp();
    const session = await adminLogin(app);
    await app.inject({
      method: 'PATCH',
      url: '/admin/settings',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session, 'content-type': 'application/json' },
      payload: { ipAllowlist: '127.0.0.1' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${gatewayKey}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('masks gateway key in admin responses', async () => {
    const { app } = await buildTestApp();
    const session = await adminLogin(app);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/settings',
      cookies: { admin_session: session },
      headers: { 'x-csrf-token': session },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('mimo_');
  });
});
