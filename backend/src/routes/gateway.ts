/**
 * Gateway routes — the public-facing API endpoints.
 * Replaces the old proxy.ts with multi-provider support via RequestOrchestrator.
 *
 * Endpoints:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions
 *   POST /v1/completions
 *   POST /v1/embeddings
 *   POST /v1/tokenize
 *   POST /v1/messages  (Anthropic-compatible)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { RequestOrchestrator } from '../routing/request-orchestrator.js';
import { RouteResolver } from '../routing/route-resolver.js';
import { modelRoutes } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { CanonicalRequest, IngressProtocol } from '../providers/types.js';

export async function registerGatewayRoutes(app: FastifyInstance, db: Db) {
  const orchestrator = new RequestOrchestrator(db);
  const routeResolver = new RouteResolver(db);

  // ── Health ─────────────────────────────────────────────────
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', app: config.appName });
  });

  // ── Models (OpenAI-compatible) ─────────────────────────────
  app.get('/v1/models', async (request, reply) => {
    // Return only public routes as models
    const publicRoutes = await routeResolver.getPublicRoutes();

    // Also include legacy public models from settings
    const setting = await db.query.settings.findFirst();
    const legacyIds = new Set((setting?.publicModelIds || 'mimo-v2.5,mimo-v2.5-pro').split(',').map(s => s.trim()));

    const seen = new Set<string>();
    const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];

    for (const route of publicRoutes) {
      if (seen.has(route.publicModelId)) continue;
      seen.add(route.publicModelId);
      models.push({
        id: route.publicModelId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'gateway',
      });
    }

    // Add legacy models not already covered by routes
    for (const id of legacyIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'mimo',
      });
    }

    return reply.send({ object: 'list', data: models });
  });

  // ── Helper to parse stream flag ────────────────────────────
  function isStreaming(body: unknown): boolean {
    return !!(body && typeof body === 'object' && (body as any).stream === true);
  }

  function extractModel(body: unknown): string {
    if (body && typeof body === 'object' && typeof (body as any).model === 'string') {
      return (body as any).model;
    }
    return 'unknown';
  }

  // ── OpenAI Chat Completions ────────────────────────────────
  app.post('/v1/chat/completions', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as any;
    const canonical: CanonicalRequest = {
      model: body?.model ?? 'unknown',
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

    return orchestrator.execute(app, request, reply, canonical, 'openai', isStreaming(body));
  });

  // ── OpenAI Text Completions ────────────────────────────────
  app.post('/v1/completions', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as any;
    // Convert text completion to chat format
    const canonical: CanonicalRequest = {
      model: body?.model ?? 'unknown',
      messages: [{ role: 'user', content: typeof body?.prompt === 'string' ? body.prompt : String(body?.prompt ?? '') }],
      maxTokens: body?.max_tokens,
      temperature: body?.temperature,
      topP: body?.top_p,
      stop: body?.stop,
      stream: body?.stream,
    };

    return orchestrator.execute(app, request, reply, canonical, 'openai', isStreaming(body));
  });

  // ── OpenAI Embeddings ──────────────────────────────────────
  app.post('/v1/embeddings', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as any;
    // For now, pass through as a non-streaming chat request
    // Full embedding support requires protocol adapter
    const canonical: CanonicalRequest = {
      model: body?.model ?? 'unknown',
      messages: [{ role: 'user', content: typeof body?.input === 'string' ? body.input : JSON.stringify(body?.input ?? '') }],
    };

    return orchestrator.execute(app, request, reply, canonical, 'openai', false);
  });

  // ── OpenAI Tokenize ────────────────────────────────────────
  app.post('/v1/tokenize', { config: { rateLimit: false } }, async (request, reply) => {
    // Tokenize is provider-specific — pass through
    const body = request.body as any;
    const canonical: CanonicalRequest = {
      model: body?.model ?? 'unknown',
      messages: [{ role: 'user', content: body?.text ?? '' }],
    };

    return orchestrator.execute(app, request, reply, canonical, 'openai', false);
  });

  // ── Anthropic Messages ─────────────────────────────────────
  app.post('/v1/messages', { config: { rateLimit: false } }, async (request, reply) => {
    const body = request.body as any;

    // Convert Anthropic format to canonical
    const messages: CanonicalRequest['messages'] = [];

    // System prompt
    if (body?.system) {
      const systemText = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
      messages.push({ role: 'system', content: systemText });
    }

    // Messages
    for (const msg of body?.messages ?? []) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      messages.push({
        role: msg.role === 'tool' ? 'tool' : msg.role,
        content,
        ...(msg.tool_use_id ? { toolCallId: msg.tool_use_id } : {}),
      });
    }

    // Convert Anthropic tools to OpenAI format
    let tools = undefined;
    if (body?.tools) {
      tools = body.tools.map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.input_schema ?? {},
        },
      }));
    }

    const canonical: CanonicalRequest = {
      model: body?.model ?? 'unknown',
      messages,
      maxTokens: body?.max_tokens,
      temperature: body?.temperature,
      topP: body?.top_p,
      stop: body?.stop_sequences,
      stream: body?.stream,
      tools,
      toolChoice: body?.tool_choice,
    };

    return orchestrator.execute(app, request, reply, canonical, 'anthropic', isStreaming(body));
  });
}
