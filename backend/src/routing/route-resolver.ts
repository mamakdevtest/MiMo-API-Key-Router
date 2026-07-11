/**
 * Model route resolver.
 * Maps a public model ID (or legacy model ID) to a sequence of provider targets.
 */

import { eq, and, asc } from 'drizzle-orm';
import { modelRoutes, modelRouteTargets, providers, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { IngressProtocol, RouteKind } from '../providers/types.js';

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

  /**
   * Resolve a model ID to a route with ordered targets.
   * First checks explicit model_routes, then falls back to legacy direct model lookup.
   */
  async resolve(
    modelId: string,
    ingressProtocol?: IngressProtocol,
  ): Promise<ResolvedRoute | null> {
    // 1. Try explicit route
    const route = await this.db.query.modelRoutes.findFirst({
      where: and(
        eq(modelRoutes.publicModelId, modelId),
        eq(modelRoutes.enabled, true),
      ),
    });

    if (route) {
      // Check protocol allowlist
      if (route.allowedProtocolsJson && ingressProtocol) {
        try {
          const allowed = JSON.parse(route.allowedProtocolsJson) as string[];
          if (allowed.length > 0 && !allowed.includes(ingressProtocol)) {
            return null;
          }
        } catch { /* ignore parse error */ }
      }

      // Get targets ordered by priority
      const targets = await this.db
        .select({
          routeTargetId: modelRouteTargets.id,
          providerId: modelRouteTargets.providerId,
          providerModelId: modelRouteTargets.providerModelId,
          priority: modelRouteTargets.priority,
          weight: modelRouteTargets.weight,
          timeoutMs: modelRouteTargets.timeoutOverrideMs,
          maxAttempts: modelRouteTargets.maxAttemptsOverride,
          providerSlug: providers.slug,
          providerType: providers.type,
          upstreamModelId: providerModels.upstreamModelId,
          supportsTools: providerModels.supportsTools,
          supportsVision: providerModels.supportsVision,
          supportsChat: providerModels.supportsChat,
          supportsEmbeddings: providerModels.supportsEmbeddings,
          providerEnabled: providers.enabled,
          providerHealth: providers.healthStatus,
          targetEnabled: modelRouteTargets.enabled,
          modelStatus: providerModels.status,
        })
        .from(modelRouteTargets)
        .innerJoin(providers, eq(modelRouteTargets.providerId, providers.id))
        .innerJoin(providerModels, eq(modelRouteTargets.providerModelId, providerModels.id))
        .where(eq(modelRouteTargets.routeId, route.id))
        .orderBy(asc(modelRouteTargets.priority));

      const resolvedTargets: ResolvedTarget[] = targets
        .filter(t => t.targetEnabled && t.providerEnabled && t.modelStatus !== 'not_deployed')
        .map(t => ({
          routeId: route.id,
          routeTargetId: t.routeTargetId,
          providerId: t.providerId,
          providerSlug: t.providerSlug,
          providerType: t.providerType,
          providerModelId: t.providerModelId,
          upstreamModelId: t.upstreamModelId,
          priority: t.priority,
          weight: t.weight,
          timeoutMs: t.timeoutMs,
          maxAttempts: t.maxAttempts,
          supportsTools: !!t.supportsTools,
          supportsVision: !!t.supportsVision,
          supportsChat: !!t.supportsChat,
          supportsEmbeddings: !!t.supportsEmbeddings,
        }));

      if (resolvedTargets.length > 0) {
        return {
          routeId: route.id,
          publicModelId: route.publicModelId,
          routeKind: route.routeKind as RouteKind,
          strategy: route.strategy,
          targets: resolvedTargets,
        };
      }
    }

    // 2. Legacy fallback: find model by upstream ID across all providers
    const legacyModels = await this.db
      .select({
        providerModelId: providerModels.id,
        providerId: providerModels.providerId,
        upstreamModelId: providerModels.upstreamModelId,
        supportsTools: providerModels.supportsTools,
        supportsVision: providerModels.supportsVision,
        supportsChat: providerModels.supportsChat,
        supportsEmbeddings: providerModels.supportsEmbeddings,
        providerSlug: providers.slug,
        providerType: providers.type,
        providerEnabled: providers.enabled,
        providerPriority: providers.priority,
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(
        and(
          eq(providerModels.upstreamModelId, modelId),
          eq(providers.enabled, true),
        ),
      )
      .orderBy(asc(providers.priority));

    if (legacyModels.length > 0) {
      const first = legacyModels[0];
      return {
        routeId: `legacy:${modelId}`,
        publicModelId: modelId,
        routeKind: 'chat',
        strategy: 'priority_failover',
        targets: legacyModels.map((m, i) => ({
          routeId: `legacy:${modelId}`,
          routeTargetId: `legacy:${modelId}:${m.providerId}`,
          providerId: m.providerId,
          providerSlug: m.providerSlug,
          providerType: m.providerType,
          providerModelId: m.providerModelId,
          upstreamModelId: m.upstreamModelId,
          priority: i,
          weight: 1,
          timeoutMs: null,
          maxAttempts: null,
          supportsTools: !!m.supportsTools,
          supportsVision: !!m.supportsVision,
          supportsChat: !!m.supportsChat,
          supportsEmbeddings: !!m.supportsEmbeddings,
        })),
      };
    }

    return null;
  }

  /**
   * Get all public routes for the /v1/models endpoint.
   */
  async getPublicRoutes(): Promise<Array<{ publicModelId: string; displayName: string | null }>> {
    const routes = await this.db.query.modelRoutes.findMany({
      where: eq(modelRoutes.isPublic, true),
    });
    return routes.map(r => ({
      publicModelId: r.publicModelId,
      displayName: r.displayName,
    }));
  }
}
