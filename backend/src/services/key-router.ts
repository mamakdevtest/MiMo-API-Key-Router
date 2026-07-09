import { eq, asc, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { decrypt } from '../crypto/index.js';
import { apiKeys, apiKeyEvents, settings } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { ApiKeyStatus } from '@mimo/shared';

export interface SelectedKey {
  id: string;
  label: string;
  key: string;
  fallback: boolean;
}

export interface KeyStateUpdate {
  status: ApiKeyStatus;
  cooldownUntil?: Date | null;
  lastErrorCode?: number | null;
  lastErrorMessage?: string | null;
  lastErrorAt?: Date;
}

export class KeyRouter {
  constructor(private db: Db) {}

  /**
   * Select the next available key, skipping any keys in the excludeKeyIds set.
   * Automatically reactivates keys whose cooldown has expired before filtering.
   */
  async selectKey(excludeKeyIds?: Set<string>): Promise<SelectedKey | null> {
    const now = new Date();

    // Reactivate expired cooldown keys inline — this was never called before
    // Note: Drizzle stores { mode: 'timestamp' } as seconds, so we must compare with seconds
    const nowSeconds = Math.floor(now.getTime() / 1000);
    await this.db
      .update(apiKeys)
      .set({ status: 'active', cooldownUntil: null, updatedAt: now })
      .where(sql`${apiKeys.status} = 'cooldown' AND ${apiKeys.cooldownUntil} IS NOT NULL AND ${apiKeys.cooldownUntil} <= ${nowSeconds}`);

    const rows = await this.db.query.apiKeys.findMany({
      orderBy: [asc(apiKeys.priority), asc(apiKeys.createdAt)],
    });

    for (const key of rows) {
      // Skip keys that have already been tried in this request
      if (excludeKeyIds && excludeKeyIds.has(key.id)) continue;
      // Skip permanently unavailable keys
      if (key.status === 'exhausted' || key.status === 'invalid' || key.status === 'disabled') continue;
      // Skip keys still in cooldown (shouldn't happen after reactivation above, but safety net)
      if (key.status === 'cooldown' && key.cooldownUntil && new Date(key.cooldownUntil) > now) continue;

      const decrypted = decrypt(key.encryptedKey, config.encryptionKey);
      return {
        id: key.id,
        label: key.label,
        key: decrypted,
        fallback: (excludeKeyIds?.size ?? 0) > 0,
      };
    }

    return null;
  }

  /**
   * Mark a key with a new state — AWAITED to ensure DB is updated before next selectKey call.
   */
  async markKeyState(keyId: string, update: KeyStateUpdate) {
    await this.db.transaction((tx) => {
      tx.update(apiKeys)
        .set({
          status: update.status,
          cooldownUntil: update.cooldownUntil,
          lastErrorCode: update.lastErrorCode ?? null,
          lastErrorMessage: update.lastErrorMessage ?? null,
          lastErrorAt: update.lastErrorAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyId))
        .run();

      tx.insert(apiKeyEvents).values({
        id: crypto.randomUUID(),
        apiKeyId: keyId,
        eventType: update.status,
        errorCode: update.lastErrorCode ?? null,
        errorMessage: update.lastErrorMessage ?? null,
        createdAt: new Date(),
      }).run();
    });
  }

  async recordUsage(keyId: string) {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
  }

  async getCooldownDuration(statusCode: number): Promise<number> {
    const setting = await this.db.query.settings.findFirst();
    if (!setting) return 60;
    if (statusCode === 429) return setting.cooldown429Seconds;
    if (statusCode >= 500 && statusCode < 600) return setting.cooldown5xxSeconds;
    return setting.cooldownTimeoutSeconds;
  }

  async resetCooldownsIfExpired() {
    const now = new Date();
    await this.db
      .update(apiKeys)
      .set({ status: 'active', cooldownUntil: null, updatedAt: now })
      .where(sql`${apiKeys.status} = 'cooldown' AND ${apiKeys.cooldownUntil} <= ${now}`);
  }
}
