import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, asc, sql, count, gte } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { encrypt, maskKey } from '../crypto/index.js';
import { apiKeys, settings, requestLogs } from '../db/schema.js';
import type { Db } from '../db/index.js';
import { ALL_MODELS } from '@mimo/shared';

const createKeySchema = z.object({
  label: z.string().min(1).max(100),
  key: z.string().min(1),
  priority: z.number().int().min(0),
  note: z.string().max(500).optional(),
});

const updateKeySchema = z.object({
  label: z.string().min(1).max(100).optional(),
  priority: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
});

const updateSettingsSchema = z.object({
  cooldown429Seconds: z.number().int().min(1).max(86400).optional(),
  cooldown5xxSeconds: z.number().int().min(1).max(86400).optional(),
  cooldownTimeoutSeconds: z.number().int().min(1).max(86400).optional(),
  requestTimeoutSeconds: z.number().int().min(1).max(600).optional(),
  ipAllowlist: z.string().optional(),
  publicModelIds: z.array(z.string()).optional(),
});

function toKeyResponse(key: typeof apiKeys.$inferSelect) {
  return {
    id: key.id,
    label: key.label,
    maskedKey: key.maskedKey,
    priority: key.priority,
    status: key.status,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    lastErrorCode: key.lastErrorCode,
    lastErrorMessage: key.lastErrorMessage,
    lastErrorAt: key.lastErrorAt?.toISOString() ?? null,
    cooldownUntil: key.cooldownUntil?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
}

export async function registerAdminRoutes(app: FastifyInstance, db: Db) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin/')) return;
    if (request.url === '/admin/login' || request.url === '/admin/logout' || request.url === '/admin/me') return;
    if (!request.adminSession) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/admin/dashboard', async (request, reply) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [keyStats] = await db
      .select({
        total: count(apiKeys.id),
        active: sql<number>`sum(case when ${apiKeys.status} = 'active' then 1 else 0 end)`,
        cooldown: sql<number>`sum(case when ${apiKeys.status} = 'cooldown' then 1 else 0 end)`,
        exhausted: sql<number>`sum(case when ${apiKeys.status} = 'exhausted' then 1 else 0 end)`,
      })
      .from(apiKeys);

    const [requestStats] = await db
      .select({
        total: count(requestLogs.id),
        success: sql<number>`sum(case when ${requestLogs.statusCode} >= 200 and ${requestLogs.statusCode} < 300 then 1 else 0 end)`,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, dayAgo));

    const total = requestStats?.total ?? 0;
    const success = requestStats?.success ?? 0;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

    return reply.send({
      gatewayStatus: (keyStats?.active ?? 0) > 0 ? 'healthy' : 'degraded',
      totalKeys: keyStats?.total ?? 0,
      activeKeys: keyStats?.active ?? 0,
      cooldownKeys: keyStats?.cooldown ?? 0,
      exhaustedKeys: keyStats?.exhausted ?? 0,
      requestsLast24h: total,
      successRate,
    });
  });

  app.get('/admin/keys', async (_request, reply) => {
    const rows = await db.query.apiKeys.findMany({
      orderBy: [asc(apiKeys.priority), asc(apiKeys.createdAt)],
    });
    return reply.send(rows.map(toKeyResponse));
  });

  app.post('/admin/keys', async (request, reply) => {
    const parsed = createKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });
    }

    const { label, key, priority } = parsed.data;

    await db.transaction((tx) => {
      tx.update(apiKeys)
        .set({ priority: sql`${apiKeys.priority} + 1` })
        .where(sql`${apiKeys.priority} >= ${priority}`)
        .run();

      tx.insert(apiKeys).values({
        id: crypto.randomUUID(),
        label,
        encryptedKey: encrypt(key, config.encryptionKey),
        maskedKey: maskKey(key),
        priority,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();
    });

    return reply.status(201).send({ success: true });
  });

  app.get('/admin/keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
    if (!key) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(toKeyResponse(key));
  });

  app.patch('/admin/keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });
    }

    const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
    if (!key) return reply.status(404).send({ error: 'Not Found' });

    await db
      .update(apiKeys)
      .set({
        label: parsed.data.label ?? key.label,
        priority: parsed.data.priority ?? key.priority,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, id));

    return reply.send({ success: true });
  });

  app.delete('/admin/keys/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/keys/:id/enable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .update(apiKeys)
      .set({ status: 'active', cooldownUntil: null, updatedAt: new Date() })
      .where(eq(apiKeys.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/keys/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .update(apiKeys)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(eq(apiKeys.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/keys/:id/reset', async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .update(apiKeys)
      .set({ status: 'active', cooldownUntil: null, lastErrorCode: null, lastErrorMessage: null, lastErrorAt: null, updatedAt: new Date() })
      .where(eq(apiKeys.id, id));
    return reply.send({ success: true });
  });

  app.post('/admin/keys/:id/move', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { direction } = request.body as { direction: 'up' | 'down' };

    const rows = await db.query.apiKeys.findMany({
      orderBy: [asc(apiKeys.priority), asc(apiKeys.createdAt)],
    });

    const index = rows.findIndex((k) => k.id === id);
    if (index === -1) return reply.status(404).send({ error: 'Not Found' });
    if (direction === 'up' && index === 0) return reply.send({ success: true });
    if (direction === 'down' && index === rows.length - 1) return reply.send({ success: true });

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const current = rows[index];
    const swap = rows[swapIndex];

    await db.transaction((tx) => {
      tx.update(apiKeys).set({ priority: swap.priority, updatedAt: new Date() }).where(eq(apiKeys.id, current.id)).run();
      tx.update(apiKeys).set({ priority: current.priority, updatedAt: new Date() }).where(eq(apiKeys.id, swap.id)).run();
    });

    return reply.send({ success: true });
  });

  app.get('/admin/settings', async (_request, reply) => {
    const setting = await db.query.settings.findFirst();
    if (!setting) return reply.status(500).send({ error: 'Server Error' });
    return reply.send({
      cooldown429Seconds: setting.cooldown429Seconds,
      cooldown5xxSeconds: setting.cooldown5xxSeconds,
      cooldownTimeoutSeconds: setting.cooldownTimeoutSeconds,
      requestTimeoutSeconds: setting.requestTimeoutSeconds,
      ipAllowlist: setting.ipAllowlist,
      publicModelIds: setting.publicModelIds.split(',').map((s) => s.trim()).filter(Boolean),
    });
  });

  app.patch('/admin/settings', async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });
    }

    const update: Partial<typeof settings.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.cooldown429Seconds !== undefined) update.cooldown429Seconds = parsed.data.cooldown429Seconds;
    if (parsed.data.cooldown5xxSeconds !== undefined) update.cooldown5xxSeconds = parsed.data.cooldown5xxSeconds;
    if (parsed.data.cooldownTimeoutSeconds !== undefined) update.cooldownTimeoutSeconds = parsed.data.cooldownTimeoutSeconds;
    if (parsed.data.requestTimeoutSeconds !== undefined) update.requestTimeoutSeconds = parsed.data.requestTimeoutSeconds;
    if (parsed.data.ipAllowlist !== undefined) update.ipAllowlist = parsed.data.ipAllowlist;
    if (parsed.data.publicModelIds !== undefined) update.publicModelIds = parsed.data.publicModelIds.join(',');

    await db.update(settings).set(update).where(eq(settings.id, 'default'));
    return reply.send({ success: true });
  });

  app.get('/admin/models', async (_request, reply) => {
    const setting = await db.query.settings.findFirst();
    const publicIds = new Set((setting?.publicModelIds || 'mimo-v2.5,mimo-v2.5-pro').split(',').map((s) => s.trim()));
    return reply.send(
      ALL_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        public: publicIds.has(m.id),
      }))
    );
  });

  app.get('/admin/logs', async (request, reply) => {
    const limit = Math.min(parseInt((request.query as { limit?: string }).limit || '100', 10), 500);
    const offset = parseInt((request.query as { offset?: string }).offset || '0', 10);
    const rows = await db.query.requestLogs.findMany({
      orderBy: (logs, { desc }) => [desc(logs.timestamp)],
      limit,
      offset,
    });
    return reply.send(
      rows.map((log) => ({
        id: log.id,
        requestId: log.requestId,
        timestamp: log.timestamp.toISOString(),
        route: log.route,
        model: log.model,
        apiKeyId: log.apiKeyId,
        statusCode: log.statusCode,
        latencyMs: log.latencyMs,
        streaming: log.streaming,
        fallback: log.fallback,
        clientIp: log.clientIp,
      }))
    );
  });
}
