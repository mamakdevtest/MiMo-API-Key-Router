/**
 * High-level provider management service.
 * Handles CRUD operations, credential management, and provider lifecycle.
 */

import { eq, asc, sql, and } from 'drizzle-orm';
import { config } from '../config.js';
import { encrypt, decrypt, maskKey } from '../crypto/index.js';
import { providers, providerCredentials, providerModels, modelRoutes, modelRouteTargets, apiKeyEvents, apiKeys } from '../db/schema.js';
import { getAdapter } from './registry.js';
import type { Db } from '../db/index.js';
import type {
  ProviderInstance,
  ProviderCredential,
  ProviderType,
  ProviderHealthStatus,
  BillingMode,
  CredentialStatus,
  DecryptedProviderCredential,
  CredentialTestResult,
} from './types.js';

export class ProviderService {
  constructor(private db: Db) {}

  // ── Provider CRUD ─────────────────────────────────────────

  async list(): Promise<ProviderInstance[]> {
    const rows = await this.db.query.providers.findMany({
      orderBy: [asc(providers.priority), asc(providers.createdAt)],
    });
    return rows.map(this.mapProvider);
  }

  async getById(id: string): Promise<ProviderInstance | null> {
    const row = await this.db.query.providers.findFirst({
      where: eq(providers.id, id),
    });
    return row ? this.mapProvider(row) : null;
  }

  async getBySlug(slug: string): Promise<ProviderInstance | null> {
    const row = await this.db.query.providers.findFirst({
      where: eq(providers.slug, slug),
    });
    return row ? this.mapProvider(row) : null;
  }

  async create(data: {
    type: ProviderType;
    name: string;
    slug: string;
    baseUrl: string;
    billingMode?: BillingMode;
    priority?: number;
    configJson?: string;
    documentationUrl?: string | null;
    authHeader?: string;
    authPrefix?: string;
    modelsEndpoint?: string;
    chatCompletionsEndpoint?: string;
    embeddingsEndpoint?: string | null;
    customHeadersJson?: string | null;
    timeoutMs?: number | null;
    healthCheckEndpoint?: string | null;
    capabilitiesJson?: string | null;
  }): Promise<ProviderInstance> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.db.insert(providers).values({
      id,
      type: data.type,
      name: data.name,
      slug: data.slug,
      baseUrl: data.baseUrl,
      billingMode: data.billingMode ?? 'unknown',
      priority: data.priority ?? 0,
      routingWeight: 1,
      healthStatus: 'unknown',
      enabled: true,
      configJson: data.configJson ?? null,
      documentationUrl: data.documentationUrl ?? null,
      authHeader: data.authHeader ?? 'Authorization',
      authPrefix: data.authPrefix ?? 'Bearer ',
      modelsEndpoint: data.modelsEndpoint ?? '/models',
      chatCompletionsEndpoint: data.chatCompletionsEndpoint ?? '/chat/completions',
      embeddingsEndpoint: data.embeddingsEndpoint ?? null,
      customHeadersJson: data.customHeadersJson ?? null,
      timeoutMs: data.timeoutMs ?? null,
      healthCheckEndpoint: data.healthCheckEndpoint ?? null,
      capabilitiesJson: data.capabilitiesJson ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return (await this.getById(id))!;
  }

  async update(id: string, data: Partial<{
    name: string;
    baseUrl: string;
    enabled: boolean;
    priority: number;
    routingWeight: number;
    healthStatus: ProviderHealthStatus;
    healthMessage: string | null;
    configJson: string | null;
    billingMode: BillingMode;
    documentationUrl: string | null;
    authHeader: string;
    authPrefix: string;
    modelsEndpoint: string;
    chatCompletionsEndpoint: string;
    embeddingsEndpoint: string | null;
    customHeadersJson: string | null;
    timeoutMs: number | null;
    healthCheckEndpoint: string | null;
    capabilitiesJson: string | null;
  }>): Promise<void> {
    await this.db.update(providers).set({ ...data, updatedAt: new Date() }).where(eq(providers.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(providers).where(eq(providers.id, id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.update(providers).set({
      enabled,
      healthStatus: enabled ? 'unknown' : 'disabled',
      updatedAt: new Date(),
    }).where(eq(providers.id, id));
  }

  async updateHealth(id: string, status: ProviderHealthStatus, message?: string): Promise<void> {
    await this.db.update(providers).set({
      healthStatus: status,
      healthMessage: message ?? null,
      lastHealthCheckAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(providers.id, id));
  }

  // ── Credential CRUD ───────────────────────────────────────

  async listCredentials(providerId: string): Promise<ProviderCredential[]> {
    const rows = await this.db.query.providerCredentials.findMany({
      where: eq(providerCredentials.providerId, providerId),
      orderBy: [asc(providerCredentials.priority), asc(providerCredentials.createdAt)],
    });
    return rows.map(this.mapCredential);
  }

  async createCredential(providerId: string, data: {
    name: string;
    secret: string;
    priority?: number;
  }): Promise<ProviderCredential> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.db.insert(providerCredentials).values({
      id,
      providerId,
      name: data.name,
      encryptedSecret: encrypt(data.secret, config.encryptionKey),
      maskedSecret: maskKey(data.secret),
      priority: data.priority ?? 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    return (await this.db.query.providerCredentials.findFirst({ where: eq(providerCredentials.id, id) })) as ProviderCredential;
  }

  async updateCredential(id: string, data: Partial<{
    name: string;
    priority: number;
    status: CredentialStatus;
    cooldownUntil: Date | null;
    failureCount: number;
    successCount: number;
    lastErrorCode: number | null;
    lastErrorMessage: string | null;
  }>): Promise<void> {
    await this.db.update(providerCredentials).set({ ...data, updatedAt: new Date() }).where(eq(providerCredentials.id, id));
  }

  async deleteCredential(id: string): Promise<void> {
    await this.db.delete(providerCredentials).where(eq(providerCredentials.id, id));
  }

  async resetCredential(id: string): Promise<void> {
    await this.db.update(providerCredentials).set({
      status: 'active',
      cooldownUntil: null,
      failureCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  async setCredentialEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db.update(providerCredentials).set({
      status: enabled ? 'active' : 'disabled',
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  /**
   * Re-encrypt persisted credentials after the application moved from its
   * legacy encryption environment variable to the key derived from
   * GATEWAY_KEY. The supplied legacy key is used only in memory and is never
   * written to the database or logs. Decrypt every row before updating any
   * row, so an invalid key cannot leave a partially migrated database.
   */
  async migrateLegacyEncryptionKey(legacyKey: string): Promise<{ providerCredentials: number; legacyApiKeys: number }> {
    const [credentialRows, legacyKeyRows] = await Promise.all([
      this.db.query.providerCredentials.findMany(),
      this.db.query.apiKeys.findMany(),
    ]);

    const decryptedCredentials = credentialRows.map((row) => ({
      id: row.id,
      secret: decrypt(row.encryptedSecret, legacyKey),
    }));
    const decryptedLegacyKeys = legacyKeyRows.map((row) => ({
      id: row.id,
      secret: decrypt(row.encryptedKey, legacyKey),
    }));

    await this.db.transaction((tx) => {
      for (const credential of decryptedCredentials) {
        tx.update(providerCredentials)
          .set({ encryptedSecret: encrypt(credential.secret, config.encryptionKey), updatedAt: new Date() })
          .where(eq(providerCredentials.id, credential.id))
          .run();
      }
      for (const legacyKey of decryptedLegacyKeys) {
        tx.update(apiKeys)
          .set({ encryptedKey: encrypt(legacyKey.secret, config.encryptionKey), updatedAt: new Date() })
          .where(eq(apiKeys.id, legacyKey.id))
          .run();
      }
    });

    return { providerCredentials: decryptedCredentials.length, legacyApiKeys: decryptedLegacyKeys.length };
  }

  async markCredentialCooldown(id: string, durationMs: number, errorCode: number, errorMessage: string): Promise<void> {
    await this.db.update(providerCredentials).set({
      status: 'cooldown',
      cooldownUntil: new Date(Date.now() + durationMs),
      failureCount: sql`${providerCredentials.failureCount} + 1`,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  async markCredentialExhausted(id: string, errorCode: number, errorMessage: string): Promise<void> {
    await this.db.update(providerCredentials).set({
      status: 'exhausted',
      failureCount: sql`${providerCredentials.failureCount} + 1`,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  async markCredentialInvalid(id: string, errorCode: number, errorMessage: string): Promise<void> {
    await this.db.update(providerCredentials).set({
      status: 'invalid',
      failureCount: sql`${providerCredentials.failureCount} + 1`,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      lastErrorAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  async markCredentialSuccess(id: string): Promise<void> {
    await this.db.update(providerCredentials).set({
      successCount: sql`${providerCredentials.successCount} + 1`,
      lastSuccessAt: new Date(),
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(providerCredentials.id, id));
  }

  async reactivateExpiredCooldowns(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db
      .update(providerCredentials)
      .set({ status: 'active', cooldownUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(providerCredentials.status, 'cooldown'),
          sql`${providerCredentials.cooldownUntil} IS NOT NULL AND ${providerCredentials.cooldownUntil} <= ${now}`
        )
      );
    return 0; // Drizzle doesn't return affected rows for all drivers
  }

  // ── Credential selection ──────────────────────────────────

  async selectCredential(providerId: string, excludeIds?: Set<string>): Promise<DecryptedProviderCredential | null> {
    await this.reactivateExpiredCooldowns();

    const rows = await this.db.query.providerCredentials.findMany({
      where: eq(providerCredentials.providerId, providerId),
      orderBy: [asc(providerCredentials.priority), asc(providerCredentials.createdAt)],
    });

    for (const row of rows) {
      if (excludeIds?.has(row.id)) continue;
      if (row.status === 'exhausted' || row.status === 'invalid' || row.status === 'disabled') continue;
      if (row.status === 'cooldown' && row.cooldownUntil && new Date(row.cooldownUntil) > new Date()) continue;

      return {
        id: row.id,
        providerId: row.providerId,
        name: row.name,
        secret: decrypt(row.encryptedSecret, config.encryptionKey),
        maskedSecret: row.maskedSecret,
        priority: row.priority,
        status: row.status as CredentialStatus,
      };
    }

    return null;
  }

  // ── Test credential ───────────────────────────────────────

  async testCredential(providerId: string, credentialId: string): Promise<CredentialTestResult> {
    const provider = await this.getById(providerId);
    if (!provider) return { success: false, message: 'Provider not found' };

    const credRow = await this.db.query.providerCredentials.findFirst({
      where: eq(providerCredentials.id, credentialId),
    });
    if (!credRow) return { success: false, message: 'Credential not found' };

    const credential: DecryptedProviderCredential = {
      id: credRow.id,
      providerId: credRow.providerId,
      name: credRow.name,
      secret: decrypt(credRow.encryptedSecret, config.encryptionKey),
      maskedSecret: credRow.maskedSecret,
      priority: credRow.priority,
      status: credRow.status as CredentialStatus,
    };

    try {
      const adapter = getAdapter(provider.type);
      return await adapter.testCredential(provider, credential);
    } catch (err) {
      return { success: false, message: `Test failed: ${(err as Error).message}` };
    }
  }

  // ── Model count ───────────────────────────────────────────

  async getModelCount(providerId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(providerModels)
      .where(eq(providerModels.providerId, providerId));
    return result[0]?.count ?? 0;
  }

  async getActiveCredentialCount(providerId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(providerCredentials)
      .where(and(
        eq(providerCredentials.providerId, providerId),
        eq(providerCredentials.status, 'active')
      ));
    return result[0]?.count ?? 0;
  }

  // ── Mappers ───────────────────────────────────────────────

  private mapProvider(row: typeof providers.$inferSelect): ProviderInstance {
    return {
      id: row.id,
      type: row.type as ProviderType,
      name: row.name,
      slug: row.slug,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      priority: row.priority,
      routingWeight: row.routingWeight,
      healthStatus: row.healthStatus as ProviderHealthStatus,
      healthMessage: row.healthMessage,
      configJson: row.configJson,
      billingMode: row.billingMode as BillingMode,
      lastHealthCheckAt: row.lastHealthCheckAt,
      documentationUrl: row.documentationUrl,
      authHeader: row.authHeader,
      authPrefix: row.authPrefix,
      modelsEndpoint: row.modelsEndpoint,
      chatCompletionsEndpoint: row.chatCompletionsEndpoint,
      embeddingsEndpoint: row.embeddingsEndpoint,
      customHeadersJson: row.customHeadersJson,
      timeoutMs: row.timeoutMs,
      healthCheckEndpoint: row.healthCheckEndpoint,
      capabilitiesJson: row.capabilitiesJson,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapCredential(row: typeof providerCredentials.$inferSelect): ProviderCredential {
    return {
      id: row.id,
      providerId: row.providerId,
      name: row.name,
      encryptedSecret: row.encryptedSecret,
      maskedSecret: row.maskedSecret,
      priority: row.priority,
      status: row.status as CredentialStatus,
      cooldownUntil: row.cooldownUntil,
      failureCount: row.failureCount,
      successCount: row.successCount,
      lastUsedAt: row.lastUsedAt,
      lastSuccessAt: row.lastSuccessAt,
      lastErrorAt: row.lastErrorAt,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
