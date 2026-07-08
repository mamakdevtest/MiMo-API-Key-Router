import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { config } from '../config.js';
import { KeyRouter } from '../services/key-router.js';
import { logRequest } from '../services/request-logger.js';
import { getClientIp } from '../auth/index.js';
import { streamManager } from '../services/stream-manager.js';
import { ALL_MODELS } from '@mimo/shared';

const ANTHROPIC_ALLOWLIST = new Set([
  'anthropic-version',
  'anthropic-beta',
  'x-claude-code-*',
  'content-type',
  'accept',
]);

// MiMo V2.5 pricing (per 1M tokens) — overseas USD rates
// Source: https://api.xiaomimimo.com (June 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'mimo-v2.5-pro': { input: 0.435, output: 0.87 },
  'mimo-v2.5': { input: 0.14, output: 0.28 },
  'mimo-v2.5-asr': { input: 0.074, output: 0 },       // billed per hour of audio, shown as approximate
  'mimo-v2.5-tts': { input: 0, output: 0 },            // free for limited time
  'mimo-v2.5-tts-voiceclone': { input: 0, output: 0 },  // free for limited time
  'mimo-v2.5-tts-voicedesign': { input: 0, output: 0 }, // free for limited time
};

function findPricingForModel(model: string): { input: number; output: number } | undefined {
  const normalized = model.toLowerCase();
  
  if (MODEL_PRICING[normalized]) return MODEL_PRICING[normalized];
  
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex !== -1) {
    const stripped = normalized.slice(lastSlashIndex + 1);
    if (MODEL_PRICING[stripped]) return MODEL_PRICING[stripped];
  }
  
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.includes(key)) {
      return MODEL_PRICING[key];
    }
  }
  
  if (normalized.includes('mimo')) {
    return MODEL_PRICING['mimo-v2.5'];
  }
  
  return undefined;
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = findPricingForModel(model);
  if (!pricing) return 0;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
}

function extractTokenUsage(body: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
  if (!body || typeof body !== 'object') return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const obj = body as Record<string, unknown>;

  // OpenAI format: { usage: { prompt_tokens, completion_tokens, total_tokens } }
  if (obj.usage && typeof obj.usage === 'object') {
    const usage = obj.usage as Record<string, unknown>;
    return {
      promptTokens: (usage.prompt_tokens as number) || 0,
      completionTokens: (usage.completion_tokens as number) || 0,
      totalTokens: (usage.total_tokens as number) || 0,
    };
  }

  // Anthropic format: { usage: { input_tokens, output_tokens } }
  if (obj.usage && typeof obj.usage === 'object') {
    const usage = obj.usage as Record<string, unknown>;
    const inputTokens = (usage.input_tokens as number) || 0;
    const outputTokens = (usage.output_tokens as number) || 0;
    return {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

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
    if (lower === 'host' || lower === 'connection' || lower === 'authorization' || lower === 'content-length') continue;
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
  let selectedKeyLabel: string | null = null;

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
    selectedKeyLabel = selected.label;
    fallback = selected.fallback;

    streamManager.broadcast({
      type: 'request_started',
      keyId: selected.id,
      label: selected.label,
      model: model || 'unknown',
      timestamp: Date.now()
    });

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

      // Non-streaming: buffer response to extract token usage
      if (!isStreaming) {
        const responseText = await upstreamResponse.text();
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = null;
        }

        const tokens = extractTokenUsage(responseBody);
        const cost = calculateCost(model || '', tokens.promptTokens, tokens.completionTokens);

        reply.header('content-type', upstreamResponse.headers.get('content-type') || 'application/json');
        reply.send(responseText);

        await logRequest(db, {
          requestId,
          route,
          model,
          apiKeyId: selected.id,
          statusCode: upstreamResponse.status,
          latencyMs: Date.now() - startTime,
          streaming: false,
          fallback,
          clientIp,
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          totalTokens: tokens.totalTokens,
          estimatedCost: cost,
        });

        streamManager.broadcast({
          type: 'request_completed',
          keyId: selected.id,
          label: selected.label,
          model: model || 'unknown',
          tokens: tokens.totalTokens,
          cost,
          success: true,
          timestamp: Date.now()
        });

        return reply;
      }

      // Streaming: pipe through and try to extract usage from final chunks
      const reader = upstreamResponse.body.getReader();
      reply.raw.on('close', () => reader.cancel().catch(() => {}));

      let lastChunks: string[] = [];
      const MAX_BUFFER_CHUNKS = 5;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          reply.raw.write(chunk);

          // Buffer last few chunks to extract usage from SSE stream
          if (lastChunks.length >= MAX_BUFFER_CHUNKS) {
            lastChunks.shift();
          }
          lastChunks.push(chunk.toString('utf-8'));
        }
      } catch (err) {
        request.log.warn({ err }, 'Stream interrupted');
      } finally {
        reader.releaseLock();
      }

      // Try to extract token usage from buffered SSE chunks
      let tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      for (const chunk of lastChunks) {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const chunkTokens = extractTokenUsage(data);
              if (chunkTokens.totalTokens > 0) {
                tokens = chunkTokens;
              }
            } catch {
              // ignore parse errors from partial chunks
            }
          }
        }
      }

      const cost = calculateCost(model || '', tokens.promptTokens, tokens.completionTokens);

      await logRequest(db, {
        requestId,
        route,
        model,
        apiKeyId: selected.id,
        statusCode: upstreamResponse.status,
        latencyMs: Date.now() - startTime,
        streaming: true,
        fallback,
        clientIp,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        totalTokens: tokens.totalTokens,
        estimatedCost: cost,
      });

      streamManager.broadcast({
        type: 'request_completed',
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        tokens: tokens.totalTokens,
        cost,
        success: true,
        timestamp: Date.now()
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
      streamManager.broadcast({
        type: 'request_completed',
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        success: false,
        timestamp: Date.now()
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

  app.post('/v1/chat/completions', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as { stream?: boolean } | undefined;
    const isStreaming = body?.stream === true;
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/chat/completions', buildUpstreamHeaders, isStreaming);
  });

  app.post('/v1/messages', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as { stream?: boolean } | undefined;
    const isStreaming = body?.stream === true;
    return proxyRequest(app, request, reply, db, config.mimoAnthropicBaseUrl, '/v1/messages', buildAnthropicHeaders, isStreaming);
  });
}
