import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { hashPassword, hashGatewayKey, verifyGatewayKey, generateSecureToken } from '../crypto/index.js';
import { settings } from '../db/schema.js';
import type { Db } from '../db/index.js';

export async function setupAdmin(db: Db): Promise<string | undefined> {
  const existing = await db.query.settings.findFirst();
  if (existing) {
    // The deployment environment is authoritative for the one router key.
    // Older databases may contain a generated or prior dashboard key; update
    // only its Argon2 verifier so a normal redeploy can start successfully.
    // Provider secrets remain in SQLite and can be re-encrypted through the
    // one-time Settings migration if they used the legacy encryption scheme.
    if (!await verifyGatewayKey(existing.gatewayKeyHash, config.gatewayKey)) {
      await db.update(settings).set({
        gatewayKeyHash: await hashGatewayKey(config.gatewayKey),
        updatedAt: new Date(),
      }).where(eq(settings.id, existing.id));
    }
    return undefined;
  }

  const adminPassword = config.initialAdminPassword;
  if (!adminPassword) {
    throw new Error('INITIAL_ADMIN_PASSWORD is required for first setup');
  }

  const gatewayKeyWithPrefix = config.gatewayKey || (config.nodeEnv === 'test' ? `api_router_${generateSecureToken(32)}` : '');

  await db.insert(settings).values({
    id: 'default',
    cooldown429Seconds: 60,
    cooldown5xxSeconds: 60,
    cooldownTimeoutSeconds: 60,
    requestTimeoutSeconds: 120,
    ipAllowlist: '',
    publicModelIds: 'mimo-v2.5,mimo-v2.5-pro',
    gatewayKeyHash: gatewayKeyWithPrefix ? await hashGatewayKey(gatewayKeyWithPrefix) : '',
    adminPasswordHash: await hashPassword(adminPassword),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (gatewayKeyWithPrefix && config.nodeEnv !== 'test') {
    console.log('\n========================================');
    console.log('Gateway API Key loaded from environment.');
    console.log('========================================\n');
  }

  return gatewayKeyWithPrefix || undefined;
}
