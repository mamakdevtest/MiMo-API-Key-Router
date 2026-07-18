/**
 * Admin provider management routes.
 * CRUD for providers, credentials, model sync, plan, concurrency.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, asc, inArray, like, or } from 'drizzle-orm';
import { ProviderService } from '../providers/provider-service.js';
import { ModelSyncService } from '../services/model-sync-service.js';
import { ProviderValidationService } from '../services/provider-validation-service.js';
import { ModelBenchmarkService } from '../services/model-benchmark-service.js';
import { getAdapterSafe } from '../providers/registry.js';
import { modelBenchmarkResults, modelRoutes, modelRouteTargets, providers, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { buildPublicModelId } from '../providers/public-model-id.js';
import { validateProviderUrl } from '../security/url-validator.js';
import { serializeCustomHeaders, maskCustomHeaders } from '../security/custom-headers.js';
import { compareModelHealth, getModelHealth, serializeBenchmark, summarizeModelHealth, type ModelBenchmarkSnapshot } from '../services/model-health.js';

const customHeadersSchema = z.record(z.string(), z.string()).optional();

const createProviderSchema = z.object({
  type: z.enum(['mimo', 'featherless', 'orcarouter', 'openai_compatible']),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  baseUrl: z.string().url(),
  billingMode: z.enum(['subscription', 'per_request', 'unknown']).optional(),
  priority: z.number().int().min(0).optional(),
  configJson: z.string().optional(),
  documentationUrl: z.string().url().optional().nullable(),
  authHeader: z.string().min(1).max(100).optional(),
  authPrefix: z.string().max(50).optional(),
  modelsEndpoint: z.string().max(200).optional(),
  chatCompletionsEndpoint: z.string().max(200).optional(),
  embeddingsEndpoint: z.string().max(200).optional().nullable(),
  customHeaders: customHeadersSchema,
  timeoutMs: z.number().int().min(1000).max(120000).optional().nullable(),
  healthCheckEndpoint: z.string().max(200).optional().nullable(),
  capabilities: z.record(z.string(), z.boolean()).optional().nullable(),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  routingWeight: z.number().int().min(0).optional(),
  billingMode: z.enum(['subscription', 'per_request', 'unknown']).optional(),
  configJson: z.string().optional(),
  documentationUrl: z.string().url().optional().nullable(),
  authHeader: z.string().min(1).max(100).optional(),
  authPrefix: z.string().max(50).optional(),
  modelsEndpoint: z.string().max(200).optional(),
  chatCompletionsEndpoint: z.string().max(200).optional(),
  embeddingsEndpoint: z.string().max(200).optional().nullable(),
  customHeaders: customHeadersSchema,
  timeoutMs: z.number().int().min(1000).max(120000).optional().nullable(),
  healthCheckEndpoint: z.string().max(200).optional().nullable(),
  capabilities: z.record(z.string(), z.boolean()).optional().nullable(),
});

const validateProviderSchema = z.object({
  baseUrl: z.string().url(),
  authHeader: z.string().min(1).max(100).optional(),
  authPrefix: z.string().max(50).optional(),
  modelsEndpoint: z.string().max(200).optional(),
  chatCompletionsEndpoint: z.string().max(200).optional(),
  secret: z.string().optional(),
  customHeaders: customHeadersSchema,
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

const createCredentialSchema = z.object({
  name: z.string().min(1).max(100),
  secret: z.string().min(1),
  priority: z.number().int().min(0).optional(),
});

const bulkCreateCredentialsSchema = z.object({
  credentials: z.array(z.object({
    name: z.string().min(1).max(100),
    secret: z.string().min(1),
  })).min(1),
  startPriority: z.number().int().min(0).optional(),
});

const benchmarkModelsSchema = z.object({
  modelIds: z.array(z.string().min(1)).max(100).optional(),
  concurrency: z.number().int().min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const mixRouteSchema = z.object({
  publicModelId: z.string().min(3).max(120).regex(/^[A-Za-z0-9._/-]+$/),
  providerModelIds: z.array(z.string().min(1)).min(2),
});

export async function registerAdminProviderRoutes(app: FastifyInstance, db: Db) {
  const providerService = new ProviderService(db);
  const modelSyncService = new ModelSyncService(db);
  const validationService = new ProviderValidationService();
  const benchmarkService = new ModelBenchmarkService(db);

  function toPublicProvider(p: ReturnType<typeof providerService.list> extends Promise<Array<infer T>> ? T : never) {
    return {
      ...p,
      customHeaders: maskCustomHeaders(p.customHeadersJson),
      customHeadersJson: undefined,
    };
  }

  function snapshotFromRow(row: {
    benchmarkProviderModelId: string | null;
    benchmarkOutcome: ModelBenchmarkSnapshot['outcome'] | null;
    benchmarkLatencyMs: number | null;
    benchmarkHttpStatus: number | null;
    benchmarkErrorMessage: string | null;
    benchmarkTestedAt: Date | null;
  }): ModelBenchmarkSnapshot | null {
    if (!row.benchmarkProviderModelId || !row.benchmarkOutcome || !row.benchmarkTestedAt) return null;
    return {
      outcome: row.benchmarkOutcome,
      latencyMs: row.benchmarkLatencyMs,
      httpStatus: row.benchmarkHttpStatus,
      errorMessage: row.benchmarkErrorMessage,
      testedAt: row.benchmarkTestedAt,
    };
  }

  async function getProviderModelHealthSummary(providerId: string, providerEnabled: boolean) {
    const rows = await db.select({
      status: providerModels.status,
      benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
      benchmarkOutcome: modelBenchmarkResults.outcome,
      benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
      benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
      benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
      benchmarkTestedAt: modelBenchmarkResults.testedAt,
    }).from(providerModels)
      .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId))
      .where(eq(providerModels.providerId, providerId));
    return summarizeModelHealth(rows.map((row) => getModelHealth({
      providerEnabled,
      modelStatus: row.status,
      benchmark: snapshotFromRow(row),
    })));
  }

  // Validate a provider connection before saving (SSRF → models → auth → streaming).
  app.post('/admin/providers/validate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = validateProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const result = await validationService.validate(parsed.data);
    return reply.send(result);
  });

  app.get('/admin/providers', async (_request, reply) => {
    const list = await providerService.list();
    const enriched = await Promise.all(list.map(async (p) => ({
      ...toPublicProvider(p),
      credentialCount: await providerService.getActiveCredentialCount(p.id),
      modelCount: await providerService.getModelCount(p.id),
      modelHealth: await getProviderModelHealthSummary(p.id, p.enabled),
    })));
    return reply.send(enriched);
  });

  app.post('/admin/providers', async (request, reply) => {
    const parsed = createProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const existing = await providerService.getBySlug(parsed.data.slug);
    if (existing) return reply.status(409).send({ error: 'Conflict', message: 'Slug already exists' });

    // SSRF check on custom base URLs
    const urlCheck = await validateProviderUrl(parsed.data.baseUrl);
    if (!urlCheck.safe) {
      return reply.status(400).send({ error: 'Invalid Base URL', message: urlCheck.error });
    }

    const { customHeaders, capabilities, ...rest } = parsed.data;
    const provider = await providerService.create({
      ...rest,
      customHeadersJson: serializeCustomHeaders(customHeaders),
      capabilitiesJson: capabilities ? JSON.stringify(capabilities) : null,
    });
    return reply.status(201).send(toPublicProvider(provider));
  });

  app.get('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    const credCount = await providerService.getActiveCredentialCount(id);
    const modelCount = await providerService.getModelCount(id);
    return reply.send({
      ...toPublicProvider(provider),
      credentialCount: credCount,
      modelCount,
      modelHealth: await getProviderModelHealthSummary(id, provider.enabled),
    });
  });

  app.patch('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    if (parsed.data.baseUrl) {
      const urlCheck = await validateProviderUrl(parsed.data.baseUrl);
      if (!urlCheck.safe) {
        return reply.status(400).send({ error: 'Invalid Base URL', message: urlCheck.error });
      }
    }

    const { customHeaders, capabilities, ...rest } = parsed.data;
    await providerService.update(id, {
      ...rest,
      ...(customHeaders !== undefined ? { customHeadersJson: serializeCustomHeaders(customHeaders) } : {}),
      ...(capabilities !== undefined ? { capabilitiesJson: capabilities ? JSON.stringify(capabilities) : null } : {}),
    });
    return reply.send({ success: true });
  });

  app.delete('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await providerService.delete(id);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await providerService.setEnabled(id, true);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await providerService.setEnabled(id, false);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/test', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cred = await providerService.selectCredential(id);
    if (!cred) return reply.send({ success: false, message: 'No active credentials' });
    const result = await providerService.testCredential(id, cred.id);
    return reply.send(result);
  });

  app.post('/admin/providers/:id/sync-models', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await modelSyncService.syncProvider(id);
    return reply.send(result);
  });

  app.post('/admin/providers/:id/benchmark-models', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = benchmarkModelsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    try {
      const report = await benchmarkService.benchmark(id, parsed.data.modelIds, parsed.data.concurrency, parsed.data.limit);
      return reply.send(report);
    } catch (error) {
      const message = (error as Error).message;
      return reply.status(message === 'Provider not found' ? 404 : 409).send({ error: 'Benchmark unavailable', message });
    }
  });

  app.post('/admin/providers/:id/benchmark-all-models', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await providerService.getById(id)) return reply.status(404).send({ error: 'Not Found' });

    const job = benchmarkService.startSequentialAll(id);
    return reply.status(202).send(job);
  });

  app.post('/admin/mix-routes', async (request, reply) => {
    const parsed = mixRouteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const requestedIds = [...new Set(parsed.data.providerModelIds)];
    const models = await db
      .select({
        id: providerModels.id,
        providerId: providerModels.providerId,
        upstreamModelId: providerModels.upstreamModelId,
        providerSlug: providers.slug,
        modelStatus: providerModels.status,
        providerEnabled: providers.enabled,
        benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
        benchmarkOutcome: modelBenchmarkResults.outcome,
        benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
        benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
        benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
        benchmarkTestedAt: modelBenchmarkResults.testedAt,
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId))
      .where(and(
        inArray(providerModels.id, requestedIds),
        eq(providerModels.supportsChat, true),
        eq(providerModels.status, 'active'),
        eq(providers.enabled, true),
      ));
    if (models.length !== requestedIds.length) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Every selected model must be an active chat model of an enabled provider' });
    }

    const modelById = new Map(models.map((model) => [model.id, model]));
    const now = new Date();
    let route = await db.query.modelRoutes.findFirst({ where: eq(modelRoutes.publicModelId, parsed.data.publicModelId) });
    if (!route) {
      const routeId = crypto.randomUUID();
      await db.insert(modelRoutes).values({
        id: routeId,
        publicModelId: parsed.data.publicModelId,
        displayName: parsed.data.publicModelId,
        description: 'Automatic model failover route created from the Model Catalog',
        routeKind: 'chat',
        strategy: 'priority_failover',
        enabled: true,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
      route = (await db.query.modelRoutes.findFirst({ where: eq(modelRoutes.id, routeId) }))!;
    } else {
      await db.update(modelRoutes).set({ enabled: true, updatedAt: now }).where(eq(modelRoutes.id, route.id));
      await db.delete(modelRouteTargets).where(eq(modelRouteTargets.routeId, route.id));
    }

    for (const [priority, providerModelId] of requestedIds.entries()) {
      const model = modelById.get(providerModelId)!;
      await db.insert(modelRouteTargets).values({
        id: crypto.randomUUID(),
        routeId: route.id,
        providerId: model.providerId,
        providerModelId,
        priority,
        weight: 1,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return reply.status(201).send({
      id: route.id,
      publicModelId: parsed.data.publicModelId,
      targets: requestedIds.map((id) => {
        const model = modelById.get(id)!;
        return buildPublicModelId({ slug: model.providerSlug }, model.upstreamModelId);
      }),
      targetDetails: requestedIds.map((id) => {
        const model = modelById.get(id)!;
        const benchmark = snapshotFromRow(model);
        return {
          providerModelId: model.id,
          publicModelId: buildPublicModelId({ slug: model.providerSlug }, model.upstreamModelId),
          health: getModelHealth({ providerEnabled: model.providerEnabled, modelStatus: model.modelStatus, benchmark }),
          benchmark: serializeBenchmark(benchmark),
        };
      }),
      message: 'Mix route saved. Use this public model ID in clients.',
    });
  });

  app.get('/admin/mix-routes', async (_request, reply) => {
    const routes = await db.query.modelRoutes.findMany({ orderBy: [asc(modelRoutes.publicModelId)] });

    const result = await Promise.all(routes.map(async (route) => {
      const targets = await db
        .select({
          providerModelId: providerModels.id,
          providerName: providers.name,
          providerType: providers.type,
          providerSlug: providers.slug,
          upstreamModelId: providerModels.upstreamModelId,
          modelStatus: providerModels.status,
          providerEnabled: providers.enabled,
          priority: modelRouteTargets.priority,
          benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
          benchmarkOutcome: modelBenchmarkResults.outcome,
          benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
          benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
          benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
          benchmarkTestedAt: modelBenchmarkResults.testedAt,
        })
        .from(modelRouteTargets)
        .innerJoin(providerModels, eq(modelRouteTargets.providerModelId, providerModels.id))
        .innerJoin(providers, eq(modelRouteTargets.providerId, providers.id))
        .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId))
        .where(eq(modelRouteTargets.routeId, route.id))
        .orderBy(asc(modelRouteTargets.priority));

      return {
        id: route.id,
        publicModelId: route.publicModelId,
        enabled: route.enabled,
        updatedAt: route.updatedAt,
        targets: targets.map((target) => {
          const benchmark = snapshotFromRow(target);
          return {
            ...target,
            health: getModelHealth({ providerEnabled: target.providerEnabled, modelStatus: target.modelStatus, benchmark }),
            benchmark: serializeBenchmark(benchmark),
            publicModelId: buildPublicModelId({ slug: target.providerSlug }, target.upstreamModelId),
          };
        }),
      };
    }));

    return reply.send(result);
  });

  app.get('/admin/providers/:id/benchmark-jobs/:jobId', async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const job = benchmarkService.getJob(jobId);
    if (!job || job.providerId !== id) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(job);
  });

  app.post('/admin/providers/:id/benchmark-jobs/:jobId/cancel', async (request, reply) => {
    const { id, jobId } = request.params as { id: string; jobId: string };
    const job = benchmarkService.getJob(jobId);
    if (!job || job.providerId !== id) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(benchmarkService.cancelJob(jobId));
  });

  app.get('/admin/providers/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    const adapter = getAdapterSafe(provider.type);
    if (!adapter?.getPlan) return reply.send({ error: 'Plan not supported' });

    const cred = await providerService.selectCredential(id);
    if (!cred) return reply.send({ error: 'No active credentials' });

    try {
      const plan = await adapter.getPlan({ provider, credential: cred });
      return reply.send(plan);
    } catch (err) {
      return reply.send({ error: (err as Error).message });
    }
  });

  app.get('/admin/providers/:id/concurrency', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    const adapter = getAdapterSafe(provider.type);
    if (!adapter?.getConcurrency) return reply.send({ error: 'Concurrency not supported' });

    const cred = await providerService.selectCredential(id);
    if (!cred) return reply.send({ error: 'No active credentials' });

    try {
      const concurrency = await adapter.getConcurrency({ provider, credential: cred });
      return reply.send(concurrency);
    } catch (err) {
      return reply.send({ error: (err as Error).message });
    }
  });

  app.get('/admin/providers/:id/credentials', async (request, reply) => {
    const { id } = request.params as { id: string };
    const creds = await providerService.listCredentials(id);
    return reply.send(creds);
  });

  app.post('/admin/providers/:id/credentials', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createCredentialSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });

    const cred = await providerService.createCredential(id, parsed.data);
    return reply.status(201).send({
      id: cred.id,
      name: cred.name,
      maskedSecret: cred.maskedSecret,
      priority: cred.priority,
      status: cred.status,
    });
  });

  app.post('/admin/providers/:id/credentials/bulk', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = bulkCreateCredentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });

    const existing = await providerService.listCredentials(id);
    const occupiedPriorities = new Set(existing.map((cred) => cred.priority));
    let nextPriority = parsed.data.startPriority ?? 0;

    for (const credential of parsed.data.credentials) {
      while (occupiedPriorities.has(nextPriority)) {
        nextPriority += 1;
      }

      await providerService.createCredential(id, {
        name: credential.name,
        secret: credential.secret,
        priority: nextPriority,
      });

      occupiedPriorities.add(nextPriority);
      nextPriority += 1;
    }

    return reply.status(201).send({ success: true, count: parsed.data.credentials.length });
  });

  app.patch('/admin/providers/:id/credentials/:credentialId', async (request, reply) => {
    const { credentialId } = request.params as { id: string; credentialId: string };
    const body = request.body as any;
    await providerService.updateCredential(credentialId, body);
    return reply.send({ success: true });
  });

  app.delete('/admin/providers/:id/credentials/:credentialId', async (request, reply) => {
    const { credentialId } = request.params as { id: string; credentialId: string };
    await providerService.deleteCredential(credentialId);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/credentials/:credentialId/test', async (request, reply) => {
    const { id, credentialId } = request.params as { id: string; credentialId: string };
    const result = await providerService.testCredential(id, credentialId);
    return reply.send(result);
  });

  app.post('/admin/providers/:id/credentials/:credentialId/reset', async (request, reply) => {
    const { credentialId } = request.params as { id: string; credentialId: string };
    await providerService.resetCredential(credentialId);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/credentials/:credentialId/enable', async (request, reply) => {
    const { credentialId } = request.params as { id: string; credentialId: string };
    await providerService.setCredentialEnabled(credentialId, true);
    return reply.send({ success: true });
  });

  app.post('/admin/providers/:id/credentials/:credentialId/disable', async (request, reply) => {
    const { credentialId } = request.params as { id: string; credentialId: string };
    await providerService.setCredentialEnabled(credentialId, false);
    return reply.send({ success: true });
  });

  app.get('/admin/providers/:id/models', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { search, limit, offset } = request.query as { search?: string; limit?: string; offset?: string };

    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });
    const rows = await db.select({
      id: providerModels.id,
      providerId: providerModels.providerId,
      upstreamModelId: providerModels.upstreamModelId,
      displayName: providerModels.displayName,
      modelClass: providerModels.modelClass,
      status: providerModels.status,
      supportsChat: providerModels.supportsChat,
      providerPriority: providers.priority,
      providerEnabled: providers.enabled,
      benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
      benchmarkOutcome: modelBenchmarkResults.outcome,
      benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
      benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
      benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
      benchmarkTestedAt: modelBenchmarkResults.testedAt,
    }).from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId))
      .where(search
        ? and(eq(providerModels.providerId, id), like(providerModels.upstreamModelId, `%${search}%`))
        : eq(providerModels.providerId, id));

    const hydrated = rows.map((row) => {
      const benchmark = snapshotFromRow(row);
      return {
        ...row,
        benchmark,
        health: getModelHealth({ providerEnabled: row.providerEnabled, modelStatus: row.status, benchmark }),
      };
    }).sort(compareModelHealth);
    const start = Math.max(0, parseInt(offset || '0', 10));
    const end = start + Math.max(1, Math.min(parseInt(limit || '100', 10), 200));
    return reply.send(hydrated.slice(start, end).map(({ benchmark, ...row }) => ({
      ...row,
      benchmark: serializeBenchmark(benchmark),
      publicModelId: buildPublicModelId(provider, row.upstreamModelId),
    })));
  });

  app.get('/admin/model-catalog', async (request, reply) => {
    const { page, perPage, providerId, search } = request.query as {
      page?: string; perPage?: string; providerId?: string; search?: string;
    };

    const pageNum = parseInt(page || '1', 10);
    const perPageNum = Math.min(parseInt(perPage || '50', 10), 200);
    const offset = (Math.max(1, pageNum) - 1) * Math.max(1, perPageNum);

    const conditions = [];
    if (providerId) conditions.push(eq(providerModels.providerId, providerId));
    if (search) {
      conditions.push(or(
        like(providerModels.upstreamModelId, `%${search}%`),
        like(providerModels.displayName, `%${search}%`),
        like(providers.slug, `%${search}%`)
      ));
    }

    const whereClause = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

    const rows = await db
      .select({
        id: providerModels.id,
        providerId: providerModels.providerId,
        providerSlug: providers.slug,
        providerName: providers.name,
        providerType: providers.type,
        providerPriority: providers.priority,
        providerEnabled: providers.enabled,
        upstreamModelId: providerModels.upstreamModelId,
        displayName: providerModels.displayName,
        modelClass: providerModels.modelClass,
        status: providerModels.status,
        contextLength: providerModels.contextLength,
        supportsChat: providerModels.supportsChat,
        supportsTools: providerModels.supportsTools,
        supportsVision: providerModels.supportsVision,
        supportsEmbeddings: providerModels.supportsEmbeddings,
        lastSyncedAt: providerModels.lastSyncedAt,
        benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
        benchmarkOutcome: modelBenchmarkResults.outcome,
        benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
        benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
        benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
        benchmarkTestedAt: modelBenchmarkResults.testedAt,
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId))
      .where(whereClause)
      ;

    // Sorting before slicing keeps pagination consistent even though health
    // is derived from the current time (the stale threshold is 24 hours).
    const hydrated = rows.map((row) => {
      const benchmark = snapshotFromRow(row);
      return {
        ...row,
        benchmark,
        health: getModelHealth({ providerEnabled: row.providerEnabled, modelStatus: row.status, benchmark }),
      };
    }).sort(compareModelHealth);
    const safePerPage = Math.max(1, perPageNum);
    const models = hydrated.slice(offset, offset + safePerPage);

    return reply.send({
      models: models.map(({ benchmark, ...row }) => ({
        ...row,
        benchmark: serializeBenchmark(benchmark),
        publicModelId: buildPublicModelId({ slug: row.providerSlug }, row.upstreamModelId),
      })),
      page: pageNum,
      perPage: perPageNum,
      total: hydrated.length,
    });
  });
}
