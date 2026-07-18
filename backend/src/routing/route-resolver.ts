/**
 * Model resolver.
 * Maps a public prefixed model ID to the provider model that owns it.
 */

import { eq, asc } from 'drizzle-orm';
import { providers, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { IngressProtocol, RouteKind } from '../providers/types.js';
import { buildPublicModelId, splitPublicModelId } from '../providers/public-model-id.js';

export interface ResolvedTarget {
  routeId: string;
  routeTargetId: string;
  providerId: string;
  providerSlug: string;
  providerType: string;
  providerModelId: string;
  upstreamModelId: string;
  priority: number;
  weight: number;
  timeoutMs: number | null;
  maxAttempts: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsChat: boolean;
  supportsEmbeddings: boolean;
}

export interface ResolvedRoute {
  routeId: string;
  publicModelId: string;
  routeKind: RouteKind;
  strategy: string;
  targets: ResolvedTarget[];
}

export class RouteResolver {
  constructor(private db: Db) {}

  async resolve(
    modelId: string,
    _ingressProtocol?: IngressProtocol,
  ): Promise<ResolvedRoute | null> {
    const prefixed = splitPublicModelId(modelId);

    const rows = await this.db
      .select({
        providerModelId: providerModels.id,
        providerId: providerModels.providerId,
        upstreamModelId: providerModels.upstreamModelId,
        status: providerModels.status,
        supportsTools: providerModels.supportsTools,
        supportsVision: providerModels.supportsVision,
        supportsChat: providerModels.supportsChat,
        supportsTextCompletion: providerModels.supportsTextCompletion,
        supportsEmbeddings: providerModels.supportsEmbeddings,
        providerSlug: providers.slug,
        providerType: providers.type,
        providerEnabled: providers.enabled,
        providerPriority: providers.priority,
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(eq(providers.enabled, true))
      .orderBy(asc(providers.priority), asc(providerModels.upstreamModelId));

    const matches = rows
      .filter((row) => row.providerEnabled && row.status !== 'not_deployed' && row.status !== 'possibly_removed')
      .filter((row) => {
        if (prefixed) {
          return row.providerSlug === prefixed.providerSlug && row.upstreamModelId === prefixed.upstreamModelId;
        }

        return row.upstreamModelId === modelId;
      });

    if (matches.length === 0) return null;

    const resolvedTargets: ResolvedTarget[] = matches.map((row, index) => ({
      routeId: `provider-model:${row.providerId}:${row.providerModelId}`,
      routeTargetId: `provider-model:${row.providerId}:${row.providerModelId}`,
      providerId: row.providerId,
      providerSlug: row.providerSlug,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      upstreamModelId: row.upstreamModelId,
      priority: index,
      weight: 1,
      timeoutMs: null,
      maxAttempts: null,
      supportsTools: !!row.supportsTools,
      supportsVision: !!row.supportsVision,
      supportsChat: !!row.supportsChat,
      supportsEmbeddings: !!row.supportsEmbeddings,
    }));

    const first = matches[0];
    const publicModelId = buildPublicModelId({ slug: first.providerSlug }, first.upstreamModelId);

    return {
      routeId: `provider-model:${first.providerId}:${first.providerModelId}`,
      publicModelId,
      routeKind: first.supportsEmbeddings ? 'embedding' : first.supportsTextCompletion && !first.supportsChat ? 'text_completion' : 'chat',
      strategy: 'priority_failover',
      targets: resolvedTargets,
    };
  }

  async getPublicRoutes(): Promise<Array<{ publicModelId: string; displayName: string | null }>> {
    const rows = await this.db
      .select({
        providerSlug: providers.slug,
        upstreamModelId: providerModels.upstreamModelId,
        displayName: providerModels.displayName,
        providerEnabled: providers.enabled,
        status: providerModels.status,
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(eq(providers.enabled, true))
      .orderBy(asc(providers.priority), asc(providerModels.upstreamModelId));

    return rows
      .filter((row) => row.providerEnabled && row.status !== 'not_deployed' && row.status !== 'possibly_removed')
      .map((row) => ({
        publicModelId: buildPublicModelId({ slug: row.providerSlug }, row.upstreamModelId),
        displayName: row.displayName,
      }));
  }
}
