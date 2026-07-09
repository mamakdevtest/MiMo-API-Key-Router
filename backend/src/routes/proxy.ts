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

// ── Low Credit Detection ──────────────────────────────────────
const LOW_CREDIT_PATTERNS = [
  'low credit',
  'insufficient balance',
  'balance not enough',
  'quota exceeded',
  'account balance',
  'payment required',
  'credits exhausted',
  'billing',
  'exceeded your current quota',
  'insufficient_quota',
  'insufficient funds',
];

function isLowCreditError(body: unknown): boolean {
  if (!body) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = text.toLowerCase();
  return LOW_CREDIT_PATTERNS.some((p) => lower.includes(p));
}

// ── Pricing ──────────────────────────────────────────────────
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
  return Math.round((inputCost + outputCost) * 100_000_000) / 100_000_000; // 8 decimal places for micro-costs
}

// ── Token Usage Extraction ──────────────────────────────────
// FIX: Merged OpenAI + Anthropic format into one block. Previously the Anthropic
// branch (input_tokens/output_tokens) was dead code due to duplicate if-check.
function extractTokenUsage(body: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
} {
  const empty = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };
  if (!body || typeof body !== 'object') return empty;
  const obj = body as Record<string, unknown>;

  if (!obj.usage || typeof obj.usage !== 'object') return empty;
  const usage = obj.usage as Record<string, unknown>;

  // OpenAI: prompt_tokens / completion_tokens / total_tokens
  // Anthropic: input_tokens / output_tokens
  // Both are handled here — first found wins for each field
  const promptTokens = (usage.prompt_tokens as number) || (usage.input_tokens as number) || 0;
  const completionTokens = (usage.completion_tokens as number) || (usage.output_tokens as number) || 0;
  const totalTokens = (usage.total_tokens as number) || (promptTokens + completionTokens);

  // Cached tokens: Anthropic uses cache_read_input_tokens,
  // OpenAI uses prompt_tokens_details.cached_tokens
  let cachedTokens = 0;
  if (typeof usage.cache_read_input_tokens === 'number') {
    cachedTokens = usage.cache_read_input_tokens;
  } else if (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object') {
    const details = usage.prompt_tokens_details as Record<string, unknown>;
    if (typeof details.cached_tokens === 'number') {
      cachedTokens = details.cached_tokens;
    }
  }

  return { promptTokens, completionTokens, totalTokens, cachedTokens };
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

// ── Main Proxy Handler ──────────────────────────────────────
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

  try {
    const body = request.body as Record<string, unknown> | undefined;
    if (body && typeof body.model === 'string') {
      model = body.model;
    }
  } catch {
    // ignore
  }

  // FIX: Broadcast request_started ONCE (outside the retry loop)
  streamManager.broadcast({
    type: 'request_started',
    requestId,
    model: model || 'unknown',
    streaming: isStreaming,
    timestamp: Date.now(),
  });

  const triedKeyIds = new Set<string>();
  let attempts = 0;
  const maxAttempts = 10;
  let lastSelectedKeyId: string | null = null;
  let lastSelectedKeyLabel: string | null = null;

  while (attempts < maxAttempts) {
    attempts++;
    const selected = await router.selectKey(triedKeyIds);
    if (!selected) {
      // No more keys available
      streamManager.broadcast({
        type: 'request_completed',
        requestId,
        model: model || 'unknown',
        success: false,
        statusCode: 503,
        errorMessage: 'No available API keys',
        attempt: attempts,
        timestamp: Date.now(),
      });

      await logRequest(db, {
        requestId,
        route,
        model,
        apiKeyId: lastSelectedKeyId,
        statusCode: 503,
        latencyMs: Date.now() - startTime,
        streaming: isStreaming,
        fallback: triedKeyIds.size > 0,
        clientIp,
      });
      return reply.status(503).send({ error: 'Service Unavailable', message: 'No available API keys' });
    }

    lastSelectedKeyId = selected.id;
    lastSelectedKeyLabel = selected.label;
    triedKeyIds.add(selected.id);

    // Broadcast key selection event
    streamManager.broadcast({
      type: 'key_selected',
      requestId,
      keyId: selected.id,
      label: selected.label,
      model: model || 'unknown',
      attempt: attempts,
      fallback: selected.fallback,
      timestamp: Date.now(),
    });

    const url = `${baseUrl}${path}`;
    const headers = headerBuilder(request, selected.key);

    try {
      const controller = new AbortController();
      const timeoutMs = (await db.query.settings.findFirst())?.requestTimeoutSeconds ?? 120;
      const timeout = setTimeout(() => controller.abort(), timeoutMs * 1000);

      // Broadcast upstream sent
      streamManager.broadcast({
        type: 'upstream_sent',
        requestId,
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        attempt: attempts,
        timestamp: Date.now(),
      });

      const upstreamResponse = await fetch(url, {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
        // @ts-expect-error duplex is required for Node fetch with body
        duplex: 'half',
      });

      clearTimeout(timeout);

      // Broadcast upstream response received
      streamManager.broadcast({
        type: 'upstream_response',
        requestId,
        keyId: selected.id,
        label: selected.label,
        statusCode: upstreamResponse.status,
        attempt: attempts,
        timestamp: Date.now(),
      });

      // ── HTTP Error-Based Failover ────────────────────────────
      if (upstreamResponse.status === 402) {
        await router.markKeyState(selected.id, {
          status: 'exhausted',
          lastErrorCode: 402,
          lastErrorMessage: 'Payment required',
        });
        streamManager.broadcast({
          type: 'key_failed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          statusCode: 402,
          keyStatus: 'exhausted',
          errorMessage: 'Payment required',
          attempt: attempts,
          timestamp: Date.now(),
        });
        streamManager.broadcast({
          type: 'failover_attempted',
          requestId,
          keyId: selected.id,
          label: selected.label,
          attempt: attempts,
          timestamp: Date.now(),
        });
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
        streamManager.broadcast({
          type: 'key_failed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          statusCode: 429,
          keyStatus: 'cooldown',
          errorMessage: 'Rate limited',
          attempt: attempts,
          timestamp: Date.now(),
        });
        streamManager.broadcast({
          type: 'failover_attempted',
          requestId,
          keyId: selected.id,
          label: selected.label,
          attempt: attempts,
          timestamp: Date.now(),
        });
        continue;
      }

      if (upstreamResponse.status === 401) {
        await router.markKeyState(selected.id, {
          status: 'invalid',
          lastErrorCode: 401,
          lastErrorMessage: 'Invalid key',
        });
        streamManager.broadcast({
          type: 'key_failed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          statusCode: 401,
          keyStatus: 'invalid',
          errorMessage: 'Invalid key',
          attempt: attempts,
          timestamp: Date.now(),
        });
        streamManager.broadcast({
          type: 'failover_attempted',
          requestId,
          keyId: selected.id,
          label: selected.label,
          attempt: attempts,
          timestamp: Date.now(),
        });
        continue;
      }

      if (upstreamResponse.status === 403) {
        await router.markKeyState(selected.id, {
          status: 'disabled',
          lastErrorCode: 403,
          lastErrorMessage: 'Forbidden',
        });
        streamManager.broadcast({
          type: 'key_failed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          statusCode: 403,
          keyStatus: 'disabled',
          errorMessage: 'Forbidden',
          attempt: attempts,
          timestamp: Date.now(),
        });
        streamManager.broadcast({
          type: 'failover_attempted',
          requestId,
          keyId: selected.id,
          label: selected.label,
          attempt: attempts,
          timestamp: Date.now(),
        });
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
        streamManager.broadcast({
          type: 'key_failed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          statusCode: upstreamResponse.status,
          keyStatus: 'cooldown',
          errorMessage: `Server error (${upstreamResponse.status})`,
          attempt: attempts,
          timestamp: Date.now(),
        });
        streamManager.broadcast({
          type: 'failover_attempted',
          requestId,
          keyId: selected.id,
          label: selected.label,
          attempt: attempts,
          timestamp: Date.now(),
        });
        continue;
      }

      // Record usage for successful selection
      await router.recordUsage(selected.id);

      // ── No Body Response ─────────────────────────────────────
      if (!upstreamResponse.body) {
        reply.status(upstreamResponse.status);
        for (const [key, value] of upstreamResponse.headers.entries()) {
          if (key.toLowerCase() === 'content-encoding') continue;
          void reply.header(key, value);
        }
        await logRequest(db, {
          requestId,
          route,
          model,
          apiKeyId: selected.id,
          statusCode: upstreamResponse.status,
          latencyMs: Date.now() - startTime,
          streaming: isStreaming,
          fallback: selected.fallback,
          clientIp,
        });

        streamManager.broadcast({
          type: 'request_completed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          model: model || 'unknown',
          success: true,
          statusCode: upstreamResponse.status,
          attempt: attempts,
          timestamp: Date.now(),
        });
        return reply.send();
      }

      // ── Non-Streaming Response ───────────────────────────────
      if (!isStreaming) {
        const responseText = await upstreamResponse.text();
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          responseBody = null;
        }

        // FIX: Check response body for low-credit errors even on 200
        if (isLowCreditError(responseBody ?? responseText)) {
          await router.markKeyState(selected.id, {
            status: 'exhausted',
            lastErrorCode: upstreamResponse.status,
            lastErrorMessage: 'Low credit detected in response body',
          });
          streamManager.broadcast({
            type: 'key_failed',
            requestId,
            keyId: selected.id,
            label: selected.label,
            statusCode: upstreamResponse.status,
            keyStatus: 'exhausted',
            errorMessage: 'Low credit detected in response body',
            attempt: attempts,
            timestamp: Date.now(),
          });
          streamManager.broadcast({
            type: 'failover_attempted',
            requestId,
            keyId: selected.id,
            label: selected.label,
            attempt: attempts,
            timestamp: Date.now(),
          });
          continue;
        }

        const tokens = extractTokenUsage(responseBody);
        const cost = calculateCost(model || '', tokens.promptTokens, tokens.completionTokens);

        reply.status(upstreamResponse.status);
        for (const [key, value] of upstreamResponse.headers.entries()) {
          if (key.toLowerCase() === 'content-encoding') continue;
          void reply.header(key, value);
        }
        reply.header('content-type', upstreamResponse.headers.get('content-type') || 'application/json');
        reply.send(responseText);

        // Token/cost only logged for the successful final attempt
        await logRequest(db, {
          requestId,
          route,
          model,
          apiKeyId: selected.id,
          statusCode: upstreamResponse.status,
          latencyMs: Date.now() - startTime,
          streaming: false,
          fallback: selected.fallback,
          clientIp,
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          totalTokens: tokens.totalTokens,
          estimatedCost: cost,
        });

        streamManager.broadcast({
          type: 'request_completed',
          requestId,
          keyId: selected.id,
          label: selected.label,
          model: model || 'unknown',
          tokens: tokens.totalTokens,
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          cost,
          success: true,
          statusCode: upstreamResponse.status,
          attempt: attempts,
          fallback: selected.fallback,
          timestamp: Date.now(),
        });

        return reply;
      }

      // ── Streaming Response ───────────────────────────────────
      // FIX: Only hijack AFTER confirming the upstream returned a success status.
      // Once hijacked, we CANNOT retry — this is by design. Streaming data has
      // already been committed to the client.
      streamManager.broadcast({
        type: 'streaming_started',
        requestId,
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        streaming: true,
        attempt: attempts,
        timestamp: Date.now(),
      });

      reply.hijack();
      const rawRes = reply.raw;

      rawRes.statusCode = upstreamResponse.status;
      for (const [key, value] of upstreamResponse.headers.entries()) {
        if (key.toLowerCase() === 'content-encoding') continue;
        rawRes.setHeader(key, value);
      }

      // Crucial for Nginx/VPS: disable proxy buffering for real-time streams
      rawRes.setHeader('X-Accel-Buffering', 'no');
      rawRes.setHeader('Cache-Control', 'no-cache');
      rawRes.setHeader('Connection', 'keep-alive');

      const reader = upstreamResponse.body.getReader();
      rawRes.on('close', () => reader.cancel().catch(() => {}));

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
        // After streaming has started, NO RETRY/FALLBACK — data already sent
      } finally {
        reader.releaseLock();
      }

      // Try to extract token usage from buffered SSE chunks
      let tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };
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

      // Token/cost only for the successful streaming response
      await logRequest(db, {
        requestId,
        route,
        model,
        apiKeyId: selected.id,
        statusCode: upstreamResponse.status,
        latencyMs: Date.now() - startTime,
        streaming: true,
        fallback: selected.fallback,
        clientIp,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        totalTokens: tokens.totalTokens,
        estimatedCost: cost,
      });

      streamManager.broadcast({
        type: 'streaming_completed',
        requestId,
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        tokens: tokens.totalTokens,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        cost,
        success: true,
        statusCode: upstreamResponse.status,
        streaming: true,
        attempt: attempts,
        fallback: selected.fallback,
        timestamp: Date.now(),
      });

      streamManager.broadcast({
        type: 'request_completed',
        requestId,
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        tokens: tokens.totalTokens,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        cost,
        success: true,
        streaming: true,
        attempt: attempts,
        fallback: selected.fallback,
        timestamp: Date.now(),
      });

      return reply.raw.end();
    } catch (err) {
      const error = err as Error;

      // Determine the appropriate key state
      let keyStatus: 'cooldown' = 'cooldown';
      let errorCode = 0;
      let errorMessage = error.message;

      if (error.name === 'AbortError') {
        errorCode = 408;
        errorMessage = 'Request timeout';
      }

      const duration = await router.getCooldownDuration(errorCode);
      await router.markKeyState(selected.id, {
        status: keyStatus,
        cooldownUntil: new Date(Date.now() + duration * 1000),
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      });

      streamManager.broadcast({
        type: 'key_failed',
        requestId,
        keyId: selected.id,
        label: selected.label,
        model: model || 'unknown',
        keyStatus,
        errorMessage,
        errorCode,
        attempt: attempts,
        timestamp: Date.now(),
      });

      streamManager.broadcast({
        type: 'failover_attempted',
        requestId,
        keyId: selected.id,
        label: selected.label,
        attempt: attempts,
        timestamp: Date.now(),
      });

      continue;
    }
  }

  // All keys exhausted
  streamManager.broadcast({
    type: 'request_completed',
    requestId,
    model: model || 'unknown',
    success: false,
    statusCode: 503,
    errorMessage: 'All keys failed after maximum attempts',
    attempt: attempts,
    timestamp: Date.now(),
  });

  await logRequest(db, {
    requestId,
    route,
    model,
    apiKeyId: lastSelectedKeyId,
    statusCode: 503,
    latencyMs: Date.now() - startTime,
    streaming: isStreaming,
    fallback: true,
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
