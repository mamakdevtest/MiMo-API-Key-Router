/**
 * Model resolver.
 * Maps a public prefixed model ID to the provider model that owns it.
 */

import { and, eq, asc } from 'drizzle-orm';
import { modelRoutes, modelRouteTargets, providers, providerModels } from '../db/schema.js';
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
    const configuredRoute = await this.resolveConfiguredRoute(modelId);
    if (configuredRoute) return configuredRoute;

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

  private async resolveConfiguredRoute(modelId: string): Promise<ResolvedRoute | null> {
    const route = await this.db.query.modelRoutes.findFirst({
      where: and(eq(modelRoutes.publicModelId, modelId), eq(modelRoutes.enabled, true)),
    });
    if (!route) return null;

    const rows = await this.db
      .select({
        targetId: modelRouteTargets.id,
        providerId: providers.id,
        providerSlug: providers.slug,
        providerType: providers.type,
        providerModelId: providerModels.id,
        upstreamModelId: providerModels.upstreamModelId,
        priority: modelRouteTargets.priority,
        weight: modelRouteTargets.weight,
        timeoutMs: modelRouteTargets.timeoutOverrideMs,
        maxAttempts: modelRouteTargets.maxAttemptsOverride,
        supportsTools: providerModels.supportsTools,
        supportsVision: providerModels.supportsVision,
        supportsChat: providerModels.supportsChat,
        supportsEmbeddings: providerModels.supportsEmbeddings,
        enabled: modelRouteTargets.enabled,
        providerEnabled: providers.enabled,
        status: providerModels.status,
      })
      .from(modelRouteTargets)
      .innerJoin(providers, eq(modelRouteTargets.providerId, providers.id))
      .innerJoin(providerModels, eq(modelRouteTargets.providerModelId, providerModels.id))
      .where(eq(modelRouteTargets.routeId, route.id))
      .orderBy(asc(modelRouteTargets.priority), asc(modelRouteTargets.createdAt));

    const targets = rows
      .filter((row) => row.enabled && row.providerEnabled && row.status !== 'not_deployed' && row.status !== 'possibly_removed')
      .map((row) => ({
        routeId: route.id,
        routeTargetId: row.targetId,
        providerId: row.providerId,
        providerSlug: row.providerSlug,
        providerType: row.providerType,
        providerModelId: row.providerModelId,
        upstreamModelId: row.upstreamModelId,
        priority: row.priority,
        weight: row.weight,
        timeoutMs: row.timeoutMs,
        maxAttempts: row.maxAttempts,
        supportsTools: !!row.supportsTools,
        supportsVision: !!row.supportsVision,
        supportsChat: !!row.supportsChat,
        supportsEmbeddings: !!row.supportsEmbeddings,
      }));

    if (targets.length === 0) return null;
    return {
      routeId: route.id,
      publicModelId: route.publicModelId,
      routeKind: route.routeKind as RouteKind,
      strategy: route.strategy,
      targets,
    };
  }

  async getPublicRoutes(): Promise<Array<{ publicModelId: string; displayName: string | null }>> {
    const configuredRoutes = await this.db.query.modelRoutes.findMany({
      where: and(eq(modelRoutes.enabled, true), eq(modelRoutes.isPublic, true)),
      orderBy: [asc(modelRoutes.publicModelId)],
    });
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

    const providerRoutes = rows
      .filter((row) => row.providerEnabled && row.status !== 'not_deployed' && row.status !== 'possibly_removed')
      .map((row) => ({
        publicModelId: buildPublicModelId({ slug: row.providerSlug }, row.upstreamModelId),
        displayName: row.displayName,
      }));

    const seen = new Set<string>();
    return [
      ...configuredRoutes.map((route) => ({ publicModelId: route.publicModelId, displayName: route.displayName })),
      ...providerRoutes,
    ].filter((route) => {
      if (seen.has(route.publicModelId)) return false;
      seen.add(route.publicModelId);
      return true;
    });
  }
}
