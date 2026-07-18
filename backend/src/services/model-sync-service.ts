/**
 * Model synchronization service.
 * Fetches model catalogs from providers and updates provider_models table.
 */

import { eq, and } from 'drizzle-orm';
import { providerModels } from '../db/schema.js';
import { getAdapter } from '../providers/registry.js';
import { ProviderService } from '../providers/provider-service.js';
import type { Db } from '../db/index.js';

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
    if (!adapter.listModels) {
      return { added: 0, updated: 0, removed: 0, errors: ['Provider does not support model listing'] };
    }

    const credential = await this.providerService.selectCredential(providerId);
    if (!credential) {
      return { added: 0, updated: 0, removed: 0, errors: ['No active credentials available'] };
    }

    const result: SyncResult = { added: 0, updated: 0, removed: 0, errors: [] };
    let page = 1;
    const perPage = 100;
    const seenIds = new Set<string>();

    try {
      while (true) {
        const response = await adapter.listModels({
          provider,
          credential,
          page,
          perPage,
        });

        for (const model of response.models) {
          seenIds.add(model.upstreamModelId);

          let detail = null;
          if (adapter.getModel) {
            try {
              detail = await adapter.getModel({
                provider,
                credential,
                modelId: model.upstreamModelId,
              });
            } catch {
              detail = null;
            }
          }

          const existing = await this.db.query.providerModels.findFirst({
            where: and(
              eq(providerModels.providerId, providerId),
              eq(providerModels.upstreamModelId, model.upstreamModelId),
            ),
          });

          const payload = {
            displayName: detail?.displayName ?? model.displayName,
            modelClass: detail?.modelClass ?? model.modelClass,
            status: detail?.status ?? model.status,
            availabilityTier: detail?.availabilityTier ?? null,
            contextLength: detail?.contextLength ?? model.contextLength,
            effectiveContextLength: detail?.contextLength ?? model.contextLength,
            maxCompletionTokens: detail?.maxCompletionTokens ?? model.maxCompletionTokens,
            concurrencyCost: detail?.concurrencyCost ?? 1,
            isGated: detail?.isGated ?? model.isGated,
            availableOnCurrentPlan: detail?.availableOnCurrentPlan ?? model.availableOnCurrentPlan,
            supportsChat: detail?.supportsChat ?? true,
            supportsTextCompletion: detail?.supportsTextCompletion ?? false,
            supportsTools: detail?.supportsTools ?? false,
            supportsVision: detail?.supportsVision ?? false,
            supportsEmbeddings: detail?.supportsEmbeddings ?? false,
            inputModalitiesJson: detail ? JSON.stringify(detail.inputModalities) : null,
            outputModalitiesJson: detail ? JSON.stringify(detail.outputModalities) : null,
            tasksJson: detail ? JSON.stringify(detail.tasks) : null,
            featuresJson: null,
            pricingPrompt: detail?.pricing.prompt ?? null,
            pricingCompletion: detail?.pricing.completion ?? null,
            pricingImage: detail?.pricing.image ?? null,
            pricingRequest: detail?.pricing.request ?? null,
            metadataJson: detail ? JSON.stringify(detail.metadata) : null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          };

          if (existing) {
            await this.db.update(providerModels).set(payload).where(eq(providerModels.id, existing.id));
            result.updated++;
          } else {
            await this.db.insert(providerModels).values({
              id: crypto.randomUUID(),
              providerId,
              upstreamModelId: model.upstreamModelId,
              createdAt: new Date(),
              ...payload,
            });
            result.added++;
          }
        }

        if (response.models.length < perPage) break;
        page++;
        if (page > 100) break;
      }

      const existingModels = await this.db.query.providerModels.findMany({
        where: eq(providerModels.providerId, providerId),
      });

      for (const existing of existingModels) {
        if (!seenIds.has(existing.upstreamModelId)) {
          await this.db.update(providerModels).set({
            status: 'possibly_removed',
            updatedAt: new Date(),
          }).where(eq(providerModels.id, existing.id));
          result.removed++;
        }
      }

      await this.providerService.updateHealth(providerId, 'healthy', `Synced ${seenIds.size} models`);
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
