import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { config } from '../config.js';
import { KeyRouter } from '../services/key-router.js';
import { logRequest } from '../services/request-logger.js';
import { getClientIp } from '../auth/index.js';
import { ALL_MODELS } from '@mimo/shared';

const ANTHROPIC_ALLOWLIST = new Set([
  'anthropic-version',
  'anthropic-beta',
  'x-claude-code-*',
  'content-type',
  'accept',
]);

function generateRequestId(): string {
  return crypto.randomUUID();
}

function isAnthropicHeaderAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  if (ANTHROPIC_ALLOWLIST.has(lower)) return true;
  if (lower.startsWith('anthropic-')) return true;
  if (lower.startsWith('x-claude-code-')) return true;
  return false;
}

function buildUpstreamHeaders(request: FastifyRequest, upstreamKey: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'authorization') continue;
    if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    } else {
      headers[key] = value;
    }
  }
  headers[config.mimoAuthHeader] = `${config.mimoAuthPrefix}${upstreamKey}`;
  return headers;
}

function buildAnthropicHeaders(request: FastifyRequest, upstreamKey: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (!isAnthropicHeaderAllowed(lower)) continue;
    if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    } else {
      headers[key] = value;
    }
  }
  headers[config.mimoAuthHeader] = `${config.mimoAuthPrefix}${upstreamKey}`;
  return headers;
}

async function proxyRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  db: Db,
  baseUrl: string,
  path: string,
  headerBuilder: (req: FastifyRequest, key: string) => Record<string, string>,
  isStreaming: boolean
) {
  const router = new KeyRouter(db);
  const requestId = generateRequestId();
  const startTime = Date.now();
  const clientIp = getClientIp(request);
  const route = request.url;
  let model: string | null = null;
  let fallback = false;
  let selectedKeyId: string | null = null;

  try {
    const body = request.body as Record<string, unknown> | undefined;
    if (body && typeof body.model === 'string') {
      model = body.model;
    }
  } catch {
    // ignore
  }

  let previousKeyId: string | undefined;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    attempts++;
    const selected = await router.selectKey(previousKeyId);
    if (!selected) {
      await logRequest(db, {
        requestId,
        route,
        model,
        apiKeyId: selectedKeyId,
        statusCode: 503,
        latencyMs: Date.now() - startTime,
        streaming: isStreaming,
        fallback,
        clientIp,
      });
      return reply.status(503).send({ error: 'Service Unavailable', message: 'No available API keys' });
    }

    selectedKeyId = selected.id;
    fallback = selected.fallback;

    const url = `${baseUrl}${path}`;
    const headers = headerBuilder(request, selected.key);

    try {
      const controller = new AbortController();
      const timeoutMs = (await db.query.settings.findFirst())?.requestTimeoutSeconds ?? 120;
      const timeout = setTimeout(() => controller.abort(), timeoutMs * 1000);

      const upstreamResponse = await fetch(url, {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
        // @ts-expect-error duplex is required for Node fetch with body
        duplex: 'half',
      });

      clearTimeout(timeout);

      await router.recordUsage(selected.id);

      if (upstreamResponse.status === 402) {
        await router.markKeyState(selected.id, {
          status: 'exhausted',
          lastErrorCode: 402,
          lastErrorMessage: 'Payment required',
        });
        previousKeyId = selected.id;
        continue;
      }

      if (upstreamResponse.status === 429) {
        const duration = await router.getCooldownDuration(429);
        await router.markKeyState(selected.id, {
          status: 'cooldown',
          cooldownUntil: new Date(Date.now() + duration * 1000),
          lastErrorCode: 429,
          lastErrorMessage: 'Rate limited',
        });
        previousKeyId = selected.id;
        continue;
      }

      if (upstreamResponse.status === 401) {
        await router.markKeyState(selected.id, {
          status: 'invalid',
          lastErrorCode: 401,
          lastErrorMessage: 'Invalid key',
        });
        previousKeyId = selected.id;
        continue;
      }

      if (upstreamResponse.status === 403) {
        await router.markKeyState(selected.id, {
          status: 'disabled',
          lastErrorCode: 403,
          lastErrorMessage: 'Forbidden',
        });
        previousKeyId = selected.id;
        continue;
      }

      if (upstreamResponse.status >= 500 && upstreamResponse.status < 600) {
        const duration = await router.getCooldownDuration(upstreamResponse.status);
        await router.markKeyState(selected.id, {
          status: 'cooldown',
          cooldownUntil: new Date(Date.now() + duration * 1000),
          lastErrorCode: upstreamResponse.status,
          lastErrorMessage: 'Server error',
        });
        previousKeyId = selected.id;
        continue;
      }

      reply.status(upstreamResponse.status);
      for (const [key, value] of upstreamResponse.headers.entries()) {
        if (key.toLowerCase() === 'content-encoding') continue;
        void reply.header(key, value);
      }

      if (!upstreamResponse.body) {
        await logRequest(db, {
          requestId,
          route,
          model,
          apiKeyId: selected.id,
          statusCode: upstreamResponse.status,
          latencyMs: Date.now() - startTime,
          streaming: isStreaming,
          fallback,
          clientIp,
        });
        return reply.send();
      }

      const reader = upstreamResponse.body.getReader();
      reply.raw.on('close', () => reader.cancel().catch(() => {}));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(Buffer.from(value));
        }
      } catch (err) {
        request.log.warn({ err }, 'Stream interrupted');
      } finally {
        reader.releaseLock();
      }

      await logRequest(db, {
        requestId,
        route,
        model,
        apiKeyId: selected.id,
        statusCode: upstreamResponse.status,
        latencyMs: Date.now() - startTime,
        streaming: isStreaming,
        fallback,
        clientIp,
      });

      return reply.raw.end();
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        const duration = await router.getCooldownDuration(0);
        await router.markKeyState(selected.id, {
          status: 'cooldown',
          cooldownUntil: new Date(Date.now() + duration * 1000),
          lastErrorCode: 408,
          lastErrorMessage: 'Request timeout',
        });
        previousKeyId = selected.id;
        continue;
      }

      const duration = await router.getCooldownDuration(0);
      await router.markKeyState(selected.id, {
        status: 'cooldown',
        cooldownUntil: new Date(Date.now() + duration * 1000),
        lastErrorCode: 0,
        lastErrorMessage: error.message,
      });
      previousKeyId = selected.id;
      continue;
    }
  }

  await logRequest(db, {
    requestId,
    route,
    model,
    apiKeyId: selectedKeyId,
    statusCode: 503,
    latencyMs: Date.now() - startTime,
    streaming: isStreaming,
    fallback,
    clientIp,
  });

  return reply.status(503).send({ error: 'Service Unavailable', message: 'All keys failed' });
}

export async function registerProxyRoutes(app: FastifyInstance, db: Db) {
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  app.get('/v1/models', async (request, reply) => {
    const setting = await db.query.settings.findFirst();
    const publicIds = new Set((setting?.publicModelIds || 'mimo-v2.5,mimo-v2.5-pro').split(',').map((s) => s.trim()));
    const models = ALL_MODELS.filter((m) => publicIds.has(m.id)).map((m) => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'mimo',
    }));
    return reply.send({ object: 'list', data: models });
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as { stream?: boolean } | undefined;
    const isStreaming = body?.stream === true;
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/chat/completions', buildUpstreamHeaders, isStreaming);
  });

  app.post('/v1/messages', async (request, reply) => {
    const body = request.body as { stream?: boolean } | undefined;
    const isStreaming = body?.stream === true;
    return proxyRequest(app, request, reply, db, config.mimoAnthropicBaseUrl, '/v1/messages', buildAnthropicHeaders, isStreaming);
  });
}
