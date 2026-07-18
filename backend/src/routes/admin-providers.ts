/**
 * Admin provider management routes.
 * CRUD for providers, credentials, model sync, plan, concurrency.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, asc, like, or, sql } from 'drizzle-orm';
import { ProviderService } from '../providers/provider-service.js';
import { ModelSyncService } from '../services/model-sync-service.js';
import { ProviderValidationService } from '../services/provider-validation-service.js';
import { getAdapterSafe } from '../providers/registry.js';
import { providers, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { buildPublicModelId } from '../providers/public-model-id.js';
import { validateProviderUrl } from '../security/url-validator.js';
import { serializeCustomHeaders, maskCustomHeaders } from '../security/custom-headers.js';

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

export async function registerAdminProviderRoutes(app: FastifyInstance, db: Db) {
  const providerService = new ProviderService(db);
  const modelSyncService = new ModelSyncService(db);
  const validationService = new ProviderValidationService();

  function toPublicProvider(p: ReturnType<typeof providerService.list> extends Promise<Array<infer T>> ? T : never) {
    return {
      ...p,
      customHeaders: maskCustomHeaders(p.customHeadersJson),
      customHeadersJson: undefined,
    };
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
    return reply.send({ ...toPublicProvider(provider), credentialCount: credCount, modelCount });
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

    const rows = await db.query.providerModels.findMany({
      where: search
        ? and(eq(providerModels.providerId, id), like(providerModels.upstreamModelId, `%${search}%`))
        : eq(providerModels.providerId, id),
      limit: parseInt(limit || '100', 10),
      offset: parseInt(offset || '0', 10),
      orderBy: [asc(providerModels.upstreamModelId)],
    });

    const provider = await providerService.getById(id);
    return reply.send(rows.map((row) => ({
      ...row,
      publicModelId: provider ? buildPublicModelId(provider, row.upstreamModelId) : row.upstreamModelId,
    })));
  });

  app.get('/admin/model-catalog', async (request, reply) => {
    const { page, perPage, providerId, search } = request.query as {
      page?: string; perPage?: string; providerId?: string; search?: string;
    };

    const pageNum = parseInt(page || '1', 10);
    const perPageNum = Math.min(parseInt(perPage || '50', 10), 200);
    const offset = (pageNum - 1) * perPageNum;

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
      })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(whereClause)
      .orderBy(asc(providers.priority), asc(providerModels.upstreamModelId))
      .limit(perPageNum)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .where(whereClause);

    return reply.send({
      models: rows.map((row) => ({
        ...row,
        publicModelId: buildPublicModelId({ slug: row.providerSlug }, row.upstreamModelId),
      })),
      page: pageNum,
      perPage: perPageNum,
      total: totalRows[0]?.count ?? rows.length,
    });
  });
}
