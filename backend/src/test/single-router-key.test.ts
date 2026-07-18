import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeys, providerCredentials, settings } from '../db/schema.js';
import { encrypt, hashGatewayKey } from '../crypto/index.js';
import { ProviderService } from '../providers/provider-service.js';
import { setupAdmin } from '../services/setup.js';
import { adminLogin, buildTestApp } from './helpers.js';

function adminHeaders(session: string) {
  return {
    cookie: `admin_session=${session}`,
    'x-csrf-token': session,
    'content-type': 'application/json',
  };
}

describe('single permanent router key', () => {
  it('accepts only the configured GATEWAY_KEY and exposes no temporary key endpoint', async () => {
    const { app, gatewayKey } = await buildTestApp();
    const valid = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${gatewayKey}` } });
    expect(valid.statusCode).toBe(200);

    const invalid = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer router_temporary_key' } });
    expect(invalid.statusCode).toBe(401);

    const session = await adminLogin(app);
    const removed = await app.inject({ method: 'GET', url: '/admin/temp-keys', headers: adminHeaders(session) });
    expect(removed.statusCode).toBe(404);
  });

  it('reconciles an older persisted gateway verifier to the deployment key on startup', async () => {
    const { app, db, gatewayKey } = await buildTestApp();
    await db.update(settings).set({ gatewayKeyHash: await hashGatewayKey('older-router-key-that-is-at-least-32-chars') }).where(eq(settings.id, 'default'));
    await setupAdmin(db);

    const response = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${gatewayKey}` } });
    expect(response.statusCode).toBe(200);
  });

  it('migrates legacy encrypted credentials in memory without returning their secret', async () => {
    const { app, db } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({
      type: 'openai_compatible', name: 'Migration Provider', slug: 'migration-provider', baseUrl: 'https://example.test/v1',
    });
    const legacyKey = 'legacy-encryption-key-at-least-32-characters';
    const now = new Date();
    await db.insert(providerCredentials).values({
      id: 'legacy-provider-credential', providerId: provider.id, name: 'legacy upstream',
      encryptedSecret: encrypt('upstream-secret-value', legacyKey), maskedSecret: 'ups****alue', priority: 0,
      status: 'active', createdAt: now, updatedAt: now,
    });
    await db.insert(apiKeys).values({
      id: 'legacy-api-key', label: 'legacy', encryptedKey: encrypt('legacy-value', legacyKey), maskedKey: 'leg****alue',
      priority: 0, status: 'active', createdAt: now, updatedAt: now,
    });

    const session = await adminLogin(app);
    const migrated = await app.inject({
      method: 'POST', url: '/admin/credential-encryption/migrate', headers: adminHeaders(session), payload: { legacyKey },
    });
    expect(migrated.statusCode).toBe(200);
    expect(migrated.payload).not.toContain('upstream-secret-value');
    expect(JSON.parse(migrated.payload)).toMatchObject({ success: true, providerCredentials: 1, legacyApiKeys: 1 });

    const selected = await providerService.selectCredential(provider.id);
    expect(selected?.secret).toBe('upstream-secret-value');
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, 'legacy-api-key') });
    expect(key?.encryptedKey).not.toContain('legacy-value');
  });

  it('rejects an invalid legacy encryption key without changing stored credentials', async () => {
    const { app, db } = await buildTestApp();
    const providerService = new ProviderService(db);
    const provider = await providerService.create({
      type: 'openai_compatible', name: 'Invalid Migration', slug: 'invalid-migration', baseUrl: 'https://example.test/v1',
    });
    const correctKey = 'correct-legacy-encryption-key-at-least-32';
    const now = new Date();
    const encryptedSecret = encrypt('unchanged-upstream-secret', correctKey);
    await db.insert(providerCredentials).values({
      id: 'invalid-legacy-provider-credential', providerId: provider.id, name: 'legacy upstream',
      encryptedSecret, maskedSecret: 'unc****cret', priority: 0, status: 'active', createdAt: now, updatedAt: now,
    });

    const session = await adminLogin(app);
    const response = await app.inject({
      method: 'POST', url: '/admin/credential-encryption/migrate', headers: adminHeaders(session),
      payload: { legacyKey: 'incorrect-legacy-encryption-key-00000' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.payload).not.toContain('incorrect-legacy');
    const row = await db.query.providerCredentials.findFirst({ where: eq(providerCredentials.id, 'invalid-legacy-provider-credential') });
    expect(row?.encryptedSecret).toBe(encryptedSecret);
  });
});
