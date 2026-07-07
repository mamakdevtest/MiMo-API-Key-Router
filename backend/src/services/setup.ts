import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { hashPassword, hashGatewayKey, generateSecureToken } from '../crypto/index.js';
import { settings } from '../db/schema.js';
import type { Db } from '../db/index.js';

export async function setupAdmin(db: Db): Promise<string | undefined> {
  const existing = await db.query.settings.findFirst();
  if (existing) return undefined;

  const adminPassword = config.initialAdminPassword;
  if (!adminPassword) {
    throw new Error('INITIAL_ADMIN_PASSWORD is required for first setup');
  }

  const gatewayKey = generateSecureToken(32);
  const gatewayKeyWithPrefix = `mimo_${gatewayKey}`;

  await db.insert(settings).values({
    id: 'default',
    cooldown429Seconds: 60,
    cooldown5xxSeconds: 60,
    cooldownTimeoutSeconds: 60,
    requestTimeoutSeconds: 120,
    ipAllowlist: '',
    publicModelIds: 'mimo-v2.5,mimo-v2.5-pro',
    gatewayKeyHash: await hashGatewayKey(gatewayKeyWithPrefix),
    adminPasswordHash: await hashPassword(adminPassword),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (config.nodeEnv !== 'test') {
    console.log('\n========================================');
    console.log('Gateway API Key (save this securely):');
    console.log(gatewayKeyWithPrefix);
    console.log('========================================\n');
  }

  return gatewayKeyWithPrefix;
}
