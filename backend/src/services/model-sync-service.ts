/**
 * Model synchronization service.
 * Fetches model catalogs from providers and updates provider_models table.
 */

import { eq, and } from 'drizzle-orm';
import { providerModels, providers } from '../db/schema.js';
import { getAdapter } from '../providers/registry.js';
import { ProviderService } from '../providers/provider-service.js';
import type { Db } from '../db/index.js';
import type { DecryptedProviderCredential, ProviderInstance, CredentialStatus } from '../providers/types.js';

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  errors: string[];
}

export class ModelSyncService {
  private providerService: ProviderService;

  constructor(private db: Db) {
    this.providerService = new ProviderService(db);
  }

  async syncProvider(providerId: string): Promise<SyncResult> {
    const provider = await this.providerService.getById(providerId);
    if (!provider) return { added: 0, updated: 0, removed: 0, errors: ['Provider not found'] };

    const adapter = getAdapter(provider.type);
    if (!adapter.listModels || !adapter.getModel) {
      return { added: 0, updated: 0, removed: 0, errors: ['Provider does not support model listing'] };
    }

    // Get a credential for API calls
    const credential = await this.providerService.selectCredential(providerId);
    if (!credential) {
      return { added: 0, updated: 0, removed: 0, errors: ['No active credentials available'] };
    }

    const result: SyncResult = { added: 0, updated: 0, removed: 0, errors: [] };
    let page = 1;
    const perPage = 100;
    const seenIds = new Set<string>();

    try {
      // Paginate through all models
      while (true) {
        const response = await adapter.listModels({
          provider,
          credential,
          page,
          perPage,
        });

        for (const model of response.models) {
          seenIds.add(model.upstreamModelId);

          const existing = await this.db.query.providerModels.findFirst({
            where: and(
              eq(providerModels.providerId, providerId),
              eq(providerModels.upstreamModelId, model.upstreamModelId),
            ),
          });

          if (existing) {
            // Update
            await this.db.update(providerModels).set({
              displayName: model.displayName,
              modelClass: model.modelClass,
              status: model.status,
              contextLength: model.contextLength,
              maxCompletionTokens: model.maxCompletionTokens,
              isGated: model.isGated,
              availableOnCurrentPlan: model.availableOnCurrentPlan,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(providerModels.id, existing.id));
            result.updated++;
          } else {
            // Insert
            await this.db.insert(providerModels).values({
              id: crypto.randomUUID(),
              providerId,
              upstreamModelId: model.upstreamModelId,
              displayName: model.displayName,
              modelClass: model.modelClass,
              status: model.status,
              contextLength: model.contextLength,
              maxCompletionTokens: model.maxCompletionTokens,
              isGated: model.isGated,
              availableOnCurrentPlan: model.availableOnCurrentPlan,
              concurrencyCost: 1,
              supportsChat: true,
              lastSyncedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            result.added++;
          }
        }

        // Check if we've exhausted all pages
        if (response.models.length < perPage) break;
        page++;
        // Safety: don't fetch more than 100 pages
        if (page > 100) break;
      }

      // Mark models not seen as stale/removed
      const existingModels = await this.db.query.providerModels.findMany({
        where: eq(providerModels.providerId, providerId),
      });

      for (const existing of existingModels) {
        if (!seenIds.has(existing.upstreamModelId)) {
          // Don't delete — mark as potentially removed
          await this.db.update(providerModels).set({
            status: 'possibly_removed',
            updatedAt: new Date(),
          }).where(eq(providerModels.id, existing.id));
          result.removed++;
        }
      }

      // Update provider health
      await this.providerService.updateHealth(providerId, 'healthy', `Synced: ${result.added} added, ${result.updated} updated`);

    } catch (err) {
      result.errors.push(`Sync error: ${(err as Error).message}`);
      await this.providerService.updateHealth(providerId, 'degraded', `Sync failed: ${(err as Error).message}`);
    }

    return result;
  }

  async getSyncStatus(providerId: string): Promise<{
    modelCount: number;
    lastSyncedAt: Date | null;
  }> {
    const models = await this.db.query.providerModels.findMany({
      where: eq(providerModels.providerId, providerId),
    });

    let lastSynced: Date | null = null;
    for (const m of models) {
      if (m.lastSyncedAt && (!lastSynced || m.lastSyncedAt > lastSynced)) {
        lastSynced = m.lastSyncedAt;
      }
    }

    return { modelCount: models.length, lastSyncedAt: lastSynced };
  }
}
