/**
 * Gateway routes — the public-facing API endpoints.
 * Resolves prefixed public model IDs directly to provider models and uses provider-owned credentials.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { RequestOrchestrator } from '../routing/request-orchestrator.js';
import { RouteResolver } from '../routing/route-resolver.js';
import type { Db } from '../db/index.js';
import type { CanonicalRequest } from '../providers/types.js';

export async function registerGatewayRoutes(app: FastifyInstance, db: Db) {
  const orchestrator = new RequestOrchestrator(db);
  const routeResolver = new RouteResolver(db);

  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', app: config.appName });
  });

  app.get('/v1/models', async (_request, reply) => {
    const publicRoutes = await routeResolver.getPublicRoutes();
    const seen = new Set<string>();
    const models = publicRoutes
      .filter((route) => {
        if (seen.has(route.publicModelId)) return false;
        seen.add(route.publicModelId);
        return true;
      })
      .map((route) => ({
        id: route.publicModelId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'gateway',
      }));

    return reply.send({ object: 'list', data: models });
  });

  function isStreaming(body: unknown): boolean {
    return !!(body && typeof body === 'object' && (body as any).stream === true);
  }

  function mapResponseFormat(rf: any): CanonicalRequest['responseFormat'] {
    if (!rf || typeof rf !== 'object') return undefined;
    if (rf.type === 'json_object') return { type: 'json_object' };
    if (rf.type === 'json_schema' && rf.json_schema) {
      return { type: 'json_schema', jsonSchema: rf.json_schema };
    }
    if (rf.type === 'text') return { type: 'text' };
    return undefined;
  }

  async function handleChatRequest(request: FastifyRequest, reply: FastifyReply, protocol: 'openai' | 'anthropic') {
    const body = request.body as any;
    const model = body?.model ?? 'unknown';
    const streaming = isStreaming(body);

    const route = await routeResolver.resolve(model, protocol);
    if (!route || route.targets.length === 0) {
      return reply.status(404).send({
        error: 'Model not found',
        message: `No provider model found for: ${model}`,
      });
    }

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
      responseFormat: mapResponseFormat(body?.response_format),
      extra: body?.chat_template_kwargs ? { chat_template_kwargs: body.chat_template_kwargs } : undefined,
    };

    return orchestrator.execute(app, request, reply, canonical, protocol, streaming);
  }

  app.post('/v1/chat/completions', { config: { rateLimit: false } }, async (request, reply) => {
    return handleChatRequest(request, reply, 'openai');
  });

  app.post('/v1/completions', { config: { rateLimit: false } }, async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Use /v1/chat/completions with a provider-prefixed model ID.',
    });
  });

  app.post('/v1/embeddings', { config: { rateLimit: false } }, async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Embeddings routing is not enabled yet in the simplified provider-prefixed router.',
    });
  });

  app.post('/v1/tokenize', { config: { rateLimit: false } }, async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Tokenize is not exposed in the simplified provider-prefixed router.',
    });
  });

  app.post('/v1/messages', { config: { rateLimit: false } }, async (request, reply) => {
    return handleChatRequest(request, reply, 'anthropic');
  });
}
