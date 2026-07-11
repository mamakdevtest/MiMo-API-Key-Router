/**
 * Gateway routes — the public-facing API endpoints.
 * Uses multi-provider orchestrator when routes exist,
 * falls back to legacy MiMo proxy for backward compatibility.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { RequestOrchestrator } from '../routing/request-orchestrator.js';
import { RouteResolver } from '../routing/route-resolver.js';
import { proxyRequest } from './proxy.js';
import type { Db } from '../db/index.js';
import type { CanonicalRequest } from '../providers/types.js';

export async function registerGatewayRoutes(app: FastifyInstance, db: Db) {
  const orchestrator = new RequestOrchestrator(db);
  const routeResolver = new RouteResolver(db);

  // ── Health ─────────────────────────────────────────────────
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', app: config.appName });
  });

  // ── Models (OpenAI-compatible) ─────────────────────────────
  app.get('/v1/models', async (request, reply) => {
    const publicRoutes = await routeResolver.getPublicRoutes();
    const setting = await db.query.settings.findFirst();
    const legacyIds = new Set((setting?.publicModelIds || 'mimo-v2.5,mimo-v2.5-pro').split(',').map(s => s.trim()));

    const seen = new Set<string>();
    const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];

    for (const route of publicRoutes) {
      if (seen.has(route.publicModelId)) continue;
      seen.add(route.publicModelId);
      models.push({ id: route.publicModelId, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'gateway' });
    }

    for (const id of legacyIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({ id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'mimo' });
    }

    return reply.send({ object: 'list', data: models });
  });

  // ── Helpers ────────────────────────────────────────────────
  function isStreaming(body: unknown): boolean {
    return !!(body && typeof body === 'object' && (body as any).stream === true);
  }

  function buildUpstreamHeaders(request: FastifyRequest, upstreamKey: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'authorization' || lower === 'content-length') continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers[config.mimoAuthHeader] = `${config.mimoAuthPrefix}${upstreamKey}`;
    return headers;
  }

  function buildAnthropicHeaders(request: FastifyRequest, upstreamKey: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (!['anthropic-version', 'anthropic-beta', 'content-type', 'accept'].includes(lower) &&
          !lower.startsWith('anthropic-') && !lower.startsWith('x-claude-code-')) continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers[config.mimoAuthHeader] = `${config.mimoAuthPrefix}${upstreamKey}`;
    return headers;
  }

  /** Route-aware or legacy proxy dispatch */
  async function handleChatRequest(request: FastifyRequest, reply: FastifyReply, db: Db, protocol: 'openai' | 'anthropic') {
    const body = request.body as any;
    const model = body?.model ?? 'unknown';
    const streaming = isStreaming(body);

    // Check if a multi-provider route exists for this model
    const route = await routeResolver.resolve(model, protocol);

    if (route && route.targets.length > 0) {
      // Use multi-provider orchestrator
      const canonical: CanonicalRequest = {
        model,
        messages: (body?.messages ?? []).map((m: any) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { toolCalls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
          ...(m.name ? { name: m.name } : {}),
        })),
        maxTokens: body?.max_tokens,
        temperature: body?.temperature,
        topP: body?.top_p,
        stop: body?.stop,
        stream: body?.stream,
        tools: body?.tools,
        toolChoice: body?.tool_choice,
        extra: body?.chat_template_kwargs ? { chat_template_kwargs: body.chat_template_kwargs } : undefined,
      };
      return orchestrator.execute(app, request, reply, canonical, protocol, streaming);
    }

    // Legacy fallback: direct MiMo proxy
    if (protocol === 'anthropic') {
      return proxyRequest(app, request, reply, db, config.mimoAnthropicBaseUrl, '/v1/messages', buildAnthropicHeaders, streaming);
    }
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/chat/completions', buildUpstreamHeaders, streaming);
  }

  // ── OpenAI Chat Completions ────────────────────────────────
  app.post('/v1/chat/completions', { config: { rateLimit: false } }, async (request, reply) => {
    return handleChatRequest(request, reply, db, 'openai');
  });

  // ── OpenAI Text Completions ────────────────────────────────
  app.post('/v1/completions', { config: { rateLimit: false } }, async (request, reply) => {
    // Text completions are always legacy MiMo for now
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/completions', buildUpstreamHeaders, isStreaming(request.body));
  });

  // ── OpenAI Embeddings ──────────────────────────────────────
  app.post('/v1/embeddings', { config: { rateLimit: false } }, async (request, reply) => {
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/embeddings', buildUpstreamHeaders, false);
  });

  // ── OpenAI Tokenize ────────────────────────────────────────
  app.post('/v1/tokenize', { config: { rateLimit: false } }, async (request, reply) => {
    return proxyRequest(app, request, reply, db, config.mimoOpenAIBaseUrl, '/tokenize', buildUpstreamHeaders, false);
  });

  // ── Anthropic Messages ─────────────────────────────────────
  app.post('/v1/messages', { config: { rateLimit: false } }, async (request, reply) => {
    return handleChatRequest(request, reply, db, 'anthropic');
  });
}
