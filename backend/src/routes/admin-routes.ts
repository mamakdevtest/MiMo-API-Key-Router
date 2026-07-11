/**
 * Admin model route management routes.
 * CRUD for model_routes and model_route_targets.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { modelRoutes, modelRouteTargets, providers, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';

const createRouteSchema = z.object({
  publicModelId: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  routeKind: z.enum(['chat', 'text_completion', 'embedding']).default('chat'),
  strategy: z.enum(['priority_failover', 'weighted_round_robin', 'least_concurrency', 'lowest_cost']).default('priority_failover'),
  enabled: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  allowedProtocolsJson: z.string().optional(),
  requiredCapabilitiesJson: z.string().optional(),
});

const updateRouteSchema = z.object({
  displayName: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  routeKind: z.enum(['chat', 'text_completion', 'embedding']).optional(),
  strategy: z.enum(['priority_failover', 'weighted_round_robin', 'least_concurrency', 'lowest_cost']).optional(),
  enabled: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  allowedProtocolsJson: z.string().optional(),
  requiredCapabilitiesJson: z.string().optional(),
});

const addTargetSchema = z.object({
  providerId: z.string().min(1),
  providerModelId: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  weight: z.number().int().min(1).default(1),
  enabled: z.boolean().default(true),
  timeoutOverrideMs: z.number().int().min(1000).optional(),
  maxAttemptsOverride: z.number().int().min(1).max(20).optional(),
});

export async function registerAdminModelRoutes(app: FastifyInstance, db: Db) {

  // ── Route CRUD ─────────────────────────────────────────────

  app.get('/admin/routes', async (_request, reply) => {
    const routes = await db.query.modelRoutes.findMany({
      orderBy: [asc(modelRoutes.publicModelId)],
    });

    const enriched = await Promise.all(routes.map(async (route) => {
      const targets = await db.query.modelRouteTargets.findMany({
        where: eq(modelRouteTargets.routeId, route.id),
        orderBy: [asc(modelRouteTargets.priority)],
      });

      const enrichedTargets = await Promise.all(targets.map(async (t) => {
        const provider = await db.query.providers.findFirst({ where: eq(providers.id, t.providerId) });
        const model = await db.query.providerModels.findFirst({ where: eq(providerModels.id, t.providerModelId) });
        return {
          ...t,
          providerName: provider?.name ?? 'Unknown',
          providerType: provider?.type ?? 'unknown',
          upstreamModelId: model?.upstreamModelId ?? 'Unknown',
          supportsTools: model?.supportsTools ?? false,
          supportsVision: model?.supportsVision ?? false,
        };
      }));

      return { ...route, targets: enrichedTargets };
    }));

    return reply.send(enriched);
  });

  app.post('/admin/routes', async (request, reply) => {
    const parsed = createRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const existing = await db.query.modelRoutes.findFirst({
      where: eq(modelRoutes.publicModelId, parsed.data.publicModelId),
    });
    if (existing) return reply.status(409).send({ error: 'Conflict', message: 'Public model ID already exists' });

    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(modelRoutes).values({
      id,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });

    const route = await db.query.modelRoutes.findFirst({ where: eq(modelRoutes.id, id) });
    return reply.status(201).send(route);
  });

  app.get('/admin/routes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const route = await db.query.modelRoutes.findFirst({ where: eq(modelRoutes.id, id) });
    if (!route) return reply.status(404).send({ error: 'Not Found' });

    const targets = await db.query.modelRouteTargets.findMany({
      where: eq(modelRouteTargets.routeId, id),
      orderBy: [asc(modelRouteTargets.priority)],
    });

    const enrichedTargets = await Promise.all(targets.map(async (t) => {
      const provider = await db.query.providers.findFirst({ where: eq(providers.id, t.providerId) });
      const model = await db.query.providerModels.findFirst({ where: eq(providerModels.id, t.providerModelId) });
      return {
        ...t,
        providerName: provider?.name ?? 'Unknown',
        providerType: provider?.type ?? 'unknown',
        upstreamModelId: model?.upstreamModelId ?? 'Unknown',
        supportsTools: model?.supportsTools ?? false,
        supportsVision: model?.supportsVision ?? false,
      };
    }));

    return reply.send({ ...route, targets: enrichedTargets });
  });

  app.patch('/admin/routes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    await db.update(modelRoutes).set({ ...parsed.data, updatedAt: new Date() }).where(eq(modelRoutes.id, id));
    return reply.send({ success: true });
  });

  app.delete('/admin/routes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(modelRoutes).where(eq(modelRoutes.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/routes/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.update(modelRoutes).set({ enabled: true, updatedAt: new Date() }).where(eq(modelRoutes.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/routes/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.update(modelRoutes).set({ enabled: false, updatedAt: new Date() }).where(eq(modelRoutes.id, id));
    return reply.send({ success: true });
  });

  // ── Route targets ──────────────────────────────────────────

  app.get('/admin/routes/:id/targets', async (request, reply) => {
    const { id } = request.params as { id: string };
    const targets = await db.query.modelRouteTargets.findMany({
      where: eq(modelRouteTargets.routeId, id),
      orderBy: [asc(modelRouteTargets.priority)],
    });

    const enriched = await Promise.all(targets.map(async (t) => {
      const provider = await db.query.providers.findFirst({ where: eq(providers.id, t.providerId) });
      const model = await db.query.providerModels.findFirst({ where: eq(providerModels.id, t.providerModelId) });
      return {
        ...t,
        providerName: provider?.name ?? 'Unknown',
        upstreamModelId: model?.upstreamModelId ?? 'Unknown',
      };
    }));

    return reply.send(enriched);
  });

  app.post('/admin/routes/:id/targets', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = addTargetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const route = await db.query.modelRoutes.findFirst({ where: eq(modelRoutes.id, id) });
    if (!route) return reply.status(404).send({ error: 'Route not found' });

    const targetId = crypto.randomUUID();
    const now = new Date();
    await db.insert(modelRouteTargets).values({
      id: targetId,
      routeId: id,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });

    return reply.status(201).send({ id: targetId });
  });

  app.delete('/admin/routes/:routeId/targets/:targetId', async (request, reply) => {
    const { targetId } = request.params as { routeId: string; targetId: string };
    await db.delete(modelRouteTargets).where(eq(modelRouteTargets.id, targetId));
    return reply.send({ success: true });
  });

  // ── Available models for target selection ───────────────────

  app.get('/admin/available-models', async (request, reply) => {
    const { providerId } = request.query as { providerId?: string };

    let query = db.select({
      id: providerModels.id,
      providerId: providerModels.providerId,
      upstreamModelId: providerModels.upstreamModelId,
      displayName: providerModels.displayName,
      supportsTools: providerModels.supportsTools,
      supportsVision: providerModels.supportsVision,
      supportsChat: providerModels.supportsChat,
      supportsEmbeddings: providerModels.supportsEmbeddings,
      contextLength: providerModels.contextLength,
      isGated: providerModels.isGated,
      providerName: providers.name,
      providerType: providers.type,
    }).from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id));

    const rows = await query;
    return reply.send(rows);
  });
}
