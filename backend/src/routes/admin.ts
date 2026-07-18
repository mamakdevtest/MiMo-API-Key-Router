import type { FastifyInstance } from 'fastify';
import { eq, asc, desc, sql, count, gte, and, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { encrypt, maskKey } from '../crypto/index.js';
import { apiKeys, settings, requestLogs, requestAttempts, providerCredentials, providers, providerModels, modelBenchmarkResults } from '../db/schema.js';
import { streamManager } from '../services/stream-manager.js';
import { ProviderService } from '../providers/provider-service.js';
import type { Db } from '../db/index.js';
import { buildPublicModelId } from '../providers/public-model-id.js';
import { compareModelHealth, getModelHealth, serializeBenchmark, summarizeModelHealth, type ModelBenchmarkSnapshot } from '../services/model-health.js';

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

const migrateLegacyEncryptionSchema = z.object({
  legacyKey: z.string().min(32).max(4096),
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
  const providerService = new ProviderService(db);
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

  app.get('/admin/dashboard', async (_request, reply) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [credentialStats] = await db
      .select({
        total: count(providerCredentials.id),
        active: sql<number>`sum(case when ${providerCredentials.status} = 'active' then 1 else 0 end)`,
        cooldown: sql<number>`sum(case when ${providerCredentials.status} = 'cooldown' then 1 else 0 end)`,
        exhausted: sql<number>`sum(case when ${providerCredentials.status} = 'exhausted' then 1 else 0 end)`,
      })
      .from(providerCredentials);

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

    const modelRows = await db.select({
      providerEnabled: providers.enabled,
      modelStatus: providerModels.status,
      benchmarkProviderModelId: modelBenchmarkResults.providerModelId,
      benchmarkOutcome: modelBenchmarkResults.outcome,
      benchmarkLatencyMs: modelBenchmarkResults.latencyMs,
      benchmarkHttpStatus: modelBenchmarkResults.httpStatus,
      benchmarkErrorMessage: modelBenchmarkResults.errorMessage,
      benchmarkTestedAt: modelBenchmarkResults.testedAt,
    }).from(providerModels)
      .innerJoin(providers, eq(providerModels.providerId, providers.id))
      .leftJoin(modelBenchmarkResults, eq(providerModels.id, modelBenchmarkResults.providerModelId));
    const modelHealth = summarizeModelHealth(modelRows.map((row) => getModelHealth({
      providerEnabled: row.providerEnabled,
      modelStatus: row.modelStatus,
      benchmark: snapshotFromRow(row),
    }, now)));

    return reply.send({
      gatewayStatus: (credentialStats?.active ?? 0) > 0 ? 'healthy' : 'degraded',
      totalKeys: credentialStats?.total ?? 0,
      activeKeys: credentialStats?.active ?? 0,
      cooldownKeys: credentialStats?.cooldown ?? 0,
      exhaustedKeys: credentialStats?.exhausted ?? 0,
      requestsLast24h: total,
      successRate,
      modelHealth,
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

  app.post('/admin/keys/bulk', async (request, reply) => {
    const bulkSchema = z.object({
      keys: z.array(z.object({
        label: z.string().min(1).max(100),
        key: z.string().min(1),
      })),
      startPriority: z.number().int().min(0).default(0),
    });

    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });
    }

    const { keys: items, startPriority } = parsed.data;

    await db.transaction((tx) => {
      tx.update(apiKeys)
        .set({ priority: sql`${apiKeys.priority} + ${items.length}` })
        .where(sql`${apiKeys.priority} >= ${startPriority}`)
        .run();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        tx.insert(apiKeys).values({
          id: crypto.randomUUID(),
          label: item.label,
          encryptedKey: encrypt(item.key, config.encryptionKey),
          maskedKey: maskKey(item.key),
          priority: startPriority + i,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run();
      }
    });

    return reply.status(201).send({ success: true, count: items.length });
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

  app.post('/admin/credential-encryption/migrate', async (request, reply) => {
    const parsed = migrateLegacyEncryptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Enter the previous encryption key.' });
    }

    try {
      const result = await providerService.migrateLegacyEncryptionKey(parsed.data.legacyKey);
      return reply.send({ success: true, ...result });
    } catch {
      // Never disclose decrypt failures or include a candidate key in logs.
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'The previous encryption key could not decrypt the stored credentials.',
      });
    }
  });

  app.get('/admin/models', async (_request, reply) => {
    const rows = await db
      .select({
        providerSlug: providers.slug,
        providerPriority: providers.priority,
        providerEnabled: providers.enabled,
        upstreamModelId: providerModels.upstreamModelId,
        displayName: providerModels.displayName,
        providerType: providers.type,
        status: providerModels.status,
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
      .where(and(eq(providers.enabled, true), eq(providerModels.status, 'active')))
      ;

    const hydrated = rows.map((row) => {
      const benchmark = snapshotFromRow(row);
      return {
        ...row,
        benchmark,
        health: getModelHealth({ providerEnabled: row.providerEnabled, modelStatus: row.status, benchmark }),
      };
    }).sort(compareModelHealth);

    return reply.send(hydrated.map(({ benchmark, ...row }) => ({
      id: buildPublicModelId({ slug: row.providerSlug }, row.upstreamModelId),
      name: row.displayName || row.upstreamModelId,
      description: `${row.providerType} provider model`,
      public: true,
      health: row.health,
      benchmark: serializeBenchmark(benchmark),
    })));
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
        apiKeyId: log.finalCredentialId,
        statusCode: log.statusCode,
        latencyMs: log.latencyMs,
        streaming: log.streaming,
        fallback: log.fallback,
        clientIp: log.clientIp,
        promptTokens: log.promptTokens ?? 0,
        completionTokens: log.completionTokens ?? 0,
        totalTokens: log.totalTokens ?? 0,
        estimatedCost: log.estimatedCost ?? 0,
      }))
    );
  });

  app.get('/admin/usage', async (request, reply) => {
    const { period } = request.query as { period?: string };
    const now = new Date();
    let since: Date;

    switch (period) {
      case '1h':
        since = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const byModel = await db
      .select({
        model: requestLogs.publicModelId,
        requests: count(requestLogs.id),
        totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${requestLogs.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${requestLogs.completionTokens}), 0)`,
        estimatedCost: sql<number>`coalesce(sum(${requestLogs.estimatedCost}), 0)`,
        avgLatency: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)`,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, since))
      .groupBy(requestLogs.publicModelId);

    const hourlyUsage = await db
      .select({
        hour: sql<string>`strftime('%Y-%m-%d %H:00', ${requestLogs.timestamp})`,
        requests: count(requestLogs.id),
        totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
        estimatedCost: sql<number>`coalesce(sum(${requestLogs.estimatedCost}), 0)`,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, since))
      .groupBy(sql`strftime('%Y-%m-%d %H:00', ${requestLogs.timestamp})`);

    const byKey = await db
      .select({
        keyId: requestLogs.finalCredentialId,
        providerName: providers.name,
        keyLabel: providerCredentials.name,
        requests: count(requestLogs.id),
        totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
        promptTokens: sql<number>`coalesce(sum(${requestLogs.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${requestLogs.completionTokens}), 0)`,
        estimatedCost: sql<number>`coalesce(sum(${requestLogs.estimatedCost}), 0)`,
        avgLatency: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)`,
      })
      .from(requestLogs)
      .leftJoin(providerCredentials, eq(requestLogs.finalCredentialId, providerCredentials.id))
      .leftJoin(providers, eq(providerCredentials.providerId, providers.id))
      .where(gte(requestLogs.timestamp, since))
      .groupBy(requestLogs.finalCredentialId, providerCredentials.name, providers.name);

    const [totals] = await db
      .select({
        totalRequests: count(requestLogs.id),
        totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
        totalCost: sql<number>`coalesce(sum(${requestLogs.estimatedCost}), 0)`,
        avgLatency: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)`,
      })
      .from(requestLogs)
      .where(gte(requestLogs.timestamp, since));

    return reply.send({
      period: period || '24h',
      totals: {
        requests: totals?.totalRequests ?? 0,
        tokens: totals?.totalTokens ?? 0,
        cost: Math.round((totals?.totalCost ?? 0) * 100_000_000) / 100_000_000,
        avgLatency: Math.round(totals?.avgLatency ?? 0),
      },
      byModel: byModel.map((m) => ({
        model: m.model || 'unknown',
        requests: m.requests,
        totalTokens: m.totalTokens,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        estimatedCost: Math.round(m.estimatedCost * 100_000_000) / 100_000_000,
        avgLatency: Math.round(m.avgLatency),
      })),
      hourly: hourlyUsage.map((h) => ({
        hour: h.hour,
        requests: h.requests,
        totalTokens: h.totalTokens,
        estimatedCost: Math.round(h.estimatedCost * 100_000_000) / 100_000_000,
      })),
      byKey: byKey.map((k) => ({
        keyId: k.keyId || 'unknown',
        label: [k.providerName, k.keyLabel].filter(Boolean).join(' / ') || 'Unknown Key',
        requests: k.requests,
        totalTokens: k.totalTokens,
        promptTokens: k.promptTokens,
        completionTokens: k.completionTokens,
        estimatedCost: Math.round(k.estimatedCost * 100_000_000) / 100_000_000,
        avgLatency: Math.round(k.avgLatency),
      })),
    });
  });

  app.get('/admin/stream', { config: { rateLimit: false } }, (_request, reply) => {
    reply.hijack();
    const rawRes = reply.raw;
    rawRes.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    streamManager.addClient(reply);
    rawRes.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
  });

  app.get('/admin/live-flow', async (request, reply) => {
    const limit = Math.max(1, Math.min(parseInt((request.query as { limit?: string }).limit || '20', 10), 50));
    const logs = await db.select({
      id: requestLogs.id,
      requestId: requestLogs.requestId,
      timestamp: requestLogs.timestamp,
      route: requestLogs.route,
      model: requestLogs.publicModelId,
      upstreamModelId: requestLogs.upstreamModelId,
      providerName: providers.name,
      statusCode: requestLogs.statusCode,
      latencyMs: requestLogs.latencyMs,
      streaming: requestLogs.streaming,
      fallback: requestLogs.fallback,
      clientIp: requestLogs.clientIp,
      promptTokens: requestLogs.promptTokens,
      completionTokens: requestLogs.completionTokens,
      totalTokens: requestLogs.totalTokens,
      estimatedCost: requestLogs.estimatedCost,
      attemptCount: requestLogs.attemptCount,
      failoverCount: requestLogs.failoverCount,
    }).from(requestLogs)
      .leftJoin(providers, eq(requestLogs.finalProviderId, providers.id))
      .orderBy(desc(requestLogs.timestamp))
      .limit(limit);

    const logIds = logs.map((log) => log.id);
    const attempts = logIds.length === 0 ? [] : await db.select({
      requestLogId: requestAttempts.requestLogId,
      attemptNumber: requestAttempts.attemptNumber,
      providerName: providers.name,
      credentialName: providerCredentials.name,
      upstreamModelId: requestAttempts.upstreamModelId,
      startedAt: requestAttempts.startedAt,
      completedAt: requestAttempts.completedAt,
      latencyMs: requestAttempts.latencyMs,
      httpStatus: requestAttempts.httpStatus,
      result: requestAttempts.result,
      errorCode: requestAttempts.errorCode,
      errorMessage: requestAttempts.errorMessage,
      retryable: requestAttempts.retryable,
    }).from(requestAttempts)
      .leftJoin(providers, eq(requestAttempts.providerId, providers.id))
      .leftJoin(providerCredentials, eq(requestAttempts.credentialId, providerCredentials.id))
      .where(inArray(requestAttempts.requestLogId, logIds))
      .orderBy(asc(requestAttempts.attemptNumber));

    const attemptsByLogId = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const current = attemptsByLogId.get(attempt.requestLogId) ?? [];
      current.push(attempt);
      attemptsByLogId.set(attempt.requestLogId, current);
    }

    return reply.send(logs.map((log) => ({
      ...log,
      timestamp: log.timestamp.toISOString(),
      attempts: (attemptsByLogId.get(log.id) ?? []).map((attempt) => ({
        ...attempt,
        startedAt: attempt.startedAt.toISOString(),
        completedAt: attempt.completedAt?.toISOString() ?? null,
      })),
    })));
  });
}
