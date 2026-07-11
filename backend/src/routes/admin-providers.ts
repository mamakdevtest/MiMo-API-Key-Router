/**
 * Admin provider management routes.
 * CRUD for providers, credentials, model sync, plan, concurrency.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ProviderService } from '../providers/provider-service.js';
import { ModelSyncService } from '../services/model-sync-service.js';
import { getAdapterSafe } from '../providers/registry.js';
import { providers, providerCredentials, providerModels } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { ProviderType, BillingMode } from '../providers/types.js';

const createProviderSchema = z.object({
  type: z.enum(['mimo', 'featherless']),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  baseUrl: z.string().url(),
  billingMode: z.enum(['subscription', 'per_request', 'unknown']).optional(),
  priority: z.number().int().min(0).optional(),
  configJson: z.string().optional(),
});

const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  routingWeight: z.number().int().min(0).optional(),
  billingMode: z.enum(['subscription', 'per_request', 'unknown']).optional(),
  configJson: z.string().optional(),
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

  // ── Provider CRUD ──────────────────────────────────────────

  app.get('/admin/providers', async (_request, reply) => {
    const list = await providerService.list();
    const enriched = await Promise.all(list.map(async (p) => ({
      ...p,
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

    const provider = await providerService.create(parsed.data);
    return reply.status(201).send(provider);
  });

  app.get('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    const credCount = await providerService.getActiveCredentialCount(id);
    const modelCount = await providerService.getModelCount(id);
    return reply.send({ ...provider, credentialCount: credCount, modelCount });
  });

  app.patch('/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateProviderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const provider = await providerService.getById(id);
    if (!provider) return reply.status(404).send({ error: 'Not Found' });

    await providerService.update(id, parsed.data);
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

  // ── Provider actions ───────────────────────────────────────

  app.post('/admin/providers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await providerService.testCredential(id, ''); // Will use first available
    // Actually test with a real credential
    const cred = await providerService.selectCredential(id);
    if (!cred) return reply.send({ success: false, message: 'No active credentials' });
    const testResult = await providerService.testCredential(id, cred.id);
    return reply.send(testResult);
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

  // ── Credential CRUD ────────────────────────────────────────

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

    return reply.status(201).send({
      success: true,
      count: parsed.data.credentials.length,
    });
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

  // ── Provider models ────────────────────────────────────────

  app.get('/admin/providers/:id/models', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { search, limit, offset } = request.query as { search?: string; limit?: string; offset?: string };

    let query = db.select().from(providerModels).where(eq(providerModels.providerId, id));
    // Simple pagination
    const rows = await query.limit(parseInt(limit || '100')).offset(parseInt(offset || '0'));
    return reply.send(rows);
  });

  // ── Model catalog (all providers) ──────────────────────────

  app.get('/admin/model-catalog', async (request, reply) => {
    const { page, perPage, providerId, search, capability } = request.query as {
      page?: string; perPage?: string; providerId?: string; search?: string; capability?: string;
    };

    const pageNum = parseInt(page || '1');
    const perPageNum = Math.min(parseInt(perPage || '50'), 200);
    const offset = (pageNum - 1) * perPageNum;

    let whereClause = '';
    const conditions: string[] = [];

    // This is a simplified query — in production you'd use Drizzle's where builder
    const rows = await db.query.providerModels.findMany({
      limit: perPageNum,
      offset,
    });

    const total = await db.select({ count: eq(providerModels.id, providerModels.id) }).from(providerModels);

    return reply.send({
      models: rows,
      page: pageNum,
      perPage: perPageNum,
      total: rows.length,
    });
  });
}
