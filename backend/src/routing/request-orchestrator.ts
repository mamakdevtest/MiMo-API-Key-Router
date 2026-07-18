/**
 * Request orchestrator — the multi-provider proxy core.
 * Coordinates route resolution, credential selection, upstream requests,
 * failover, streaming safety, and request logging.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { getAdapter } from '../providers/registry.js';
import { ProviderService } from '../providers/provider-service.js';
import { RouteResolver, type ResolvedRoute, type ResolvedTarget } from './route-resolver.js';
import { classifyHttpError, classifyNetworkError, isLowCreditError } from './error-classifier.js';
import { extractTokenUsage, calculateCost } from '../usage/usage-normalizer.js';
import { logRequest } from '../services/request-logger.js';
import { streamManager } from '../services/stream-manager.js';
import { getClientIp } from '../auth/index.js';
import type { Db } from '../db/index.js';
import type {
  CanonicalRequest,
  CanonicalResponse,
  IngressProtocol,
  DecryptedProviderCredential,
  ProviderRequestContext,
  ClassifiedProviderError,
  NormalizedUsage,
} from '../providers/types.js';
import { requestLogs, requestAttempts } from '../db/schema.js';

// A Vercel mix may need two passes through several keys for each target model.
// The default supports six models with ten active keys; deployments can lower
// it if they want a stricter upstream request ceiling.
const MAX_UPSTREAM_ATTEMPTS = parseInt(process.env.MAX_UPSTREAM_ATTEMPTS || '120', 10);

export interface OrchestratorResult {
  success: boolean;
  statusCode: number;
  responseBody?: string;
  responseBodyParsed?: unknown;
  usage?: NormalizedUsage;
  cost?: number;
  costSource?: string;
  error?: string;
  requestLogId?: string;
}

export class RequestOrchestrator {
  private providerService: ProviderService;
  private routeResolver: RouteResolver;

  constructor(private db: Db) {
    this.providerService = new ProviderService(db);
    this.routeResolver = new RouteResolver(db);
  }

  /**
   * Execute a gateway request with full multi-provider failover.
   */
  async execute(
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    canonicalRequest: CanonicalRequest,
    ingressProtocol: IngressProtocol,
    isStreaming: boolean,
  ): Promise<OrchestratorResult> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const clientIp = getClientIp(request);
    const model = canonicalRequest.model;

    // Create the request log entry
    const logId = crypto.randomUUID();
    await this.db.insert(requestLogs).values({
      id: logId,
      requestId,
      timestamp: new Date(),
      route: request.url,
      model,
      statusCode: null,
      latencyMs: 0,
      streaming: isStreaming,
      fallback: false,
      clientIp,
      ingressProtocol,
      publicModelId: model,
    });

    streamManager.broadcast({
      type: 'request_started',
      requestId,
      model,
      streaming: isStreaming,
      timestamp: Date.now(),
    });

    // Resolve route
    const route = await this.routeResolver.resolve(model, ingressProtocol);
    if (!route || route.targets.length === 0) {
      await this.finalizeLog(logId, 404, Date.now() - startTime, false, null);
      streamManager.broadcast({
        type: 'request_completed',
        requestId,
        model,
        success: false,
        statusCode: 404,
        errorMessage: 'No route found for model',
        timestamp: Date.now(),
      });
      return reply.status(404).send({
        error: 'Model not found',
        message: `No route or provider found for model: ${model}`,
      }) as unknown as OrchestratorResult;
    }

    // Try targets in priority order with credential failover
    let attempts = 0;
    let failoverCount = 0;
    let lastError: ClassifiedProviderError | null = null;

    for (const target of route.targets) {
      if (attempts >= MAX_UPSTREAM_ATTEMPTS) break;

      // Start a fresh credential pass for each target. A key rate-limited on
      // `model-a` can still serve `model-b` in a priority-failover mix.
      const providerTried = new Set<string>();

      // Try each credential for this provider
      let credential: DecryptedProviderCredential | null = null;
      let freeTierCredentialPasses = 1;
      let sawVercelFreeTierLimit = false;
      while (attempts < MAX_UPSTREAM_ATTEMPTS) {
        credential = await this.providerService.selectCredential(target.providerId, providerTried);
        if (!credential) {
          // Vercel's per-model free-tier 429 is not a broken key. Give every
          // still-active key a second pass before falling through to a model
          // alias target (for example `vercel.mix.router`).
          if (sawVercelFreeTierLimit && freeTierCredentialPasses < 2) {
            providerTried.clear();
            freeTierCredentialPasses += 1;
            continue;
          }
          break;
        }

        attempts++;
        providerTried.add(credential.id);
        const attemptStartTime = Date.now();
        const attemptLogId = crypto.randomUUID();

        streamManager.broadcast({
          type: 'key_selected',
          requestId,
          keyId: credential.id,
          label: credential.name,
          model,
          attempt: attempts,
          fallback: attempts > 1,
          timestamp: Date.now(),
        });

        try {
          const provider = await this.providerService.getById(target.providerId);
          if (!provider) break;

          const adapter = getAdapter(provider.type as any);

          // Each route target may be a different upstream model. Set it
          // before building the request so mix routes never send the prior
          // target's model ID to the next provider/model.
          canonicalRequest.model = target.upstreamModelId;

          // Build upstream request
          const upstreamReq = await adapter.buildUpstreamRequest({
            provider,
            credential,
            canonicalRequest,
            ingressProtocol,
            routeId: route.routeId,
            routeTargetId: target.routeTargetId,
          });

          streamManager.broadcast({
            type: 'upstream_sent',
            requestId,
            keyId: credential.id,
            label: credential.name,
            model: target.upstreamModelId,
            attempt: attempts,
            timestamp: Date.now(),
          });

          // Execute upstream request
          const controller = new AbortController();
          const settings = await this.db.query.settings.findFirst();
          const timeoutMs = target.timeoutMs ?? (settings?.requestTimeoutSeconds ?? 120) * 1000;
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          const upstreamResponse = await fetch(upstreamReq.url, {
            method: upstreamReq.method,
            headers: upstreamReq.headers,
            body: upstreamReq.body,
            signal: controller.signal,
            // @ts-expect-error duplex required for Node fetch with body
            duplex: 'half',
          });

          clearTimeout(timeout);

          streamManager.broadcast({
            type: 'upstream_response',
            requestId,
            keyId: credential.id,
            label: credential.name,
            statusCode: upstreamResponse.status,
            attempt: attempts,
            timestamp: Date.now(),
          });

          // Log the attempt
          await this.db.insert(requestAttempts).values({
            id: attemptLogId,
            requestLogId: logId,
            attemptNumber: attempts,
            routeId: route.routeId,
            routeTargetId: target.routeTargetId,
            providerId: target.providerId,
            credentialId: credential.id,
            upstreamModelId: target.upstreamModelId,
            startedAt: new Date(attemptStartTime),
            completedAt: new Date(),
            latencyMs: Date.now() - attemptStartTime,
            httpStatus: upstreamResponse.status,
            result: upstreamResponse.status >= 200 && upstreamResponse.status < 300 ? 'success' : 'error',
            responseStarted: false,
            retryable: false,
          });

          // Handle HTTP errors with failover
          if (upstreamResponse.status >= 400) {
            let errorBody: unknown;
            try { errorBody = await upstreamResponse.json(); } catch { errorBody = await upstreamResponse.text().catch(() => ''); }

            const classified = adapter.classifyError
              ? await adapter.classifyError({
                  provider,
                  credential,
                  httpStatus: upstreamResponse.status,
                  responseBody: errorBody,
                  requestContext: { provider, credential, canonicalRequest, ingressProtocol, routeId: route.routeId, routeTargetId: target.routeTargetId },
                })
              : classifyHttpError(upstreamResponse.status, errorBody, provider.type);

            lastError = classified;
            if (classified.category === 'vercel_free_tier_model_rate_limited') {
              sawVercelFreeTierLimit = true;
            }

            // Update attempt with error info
            await this.db.update(requestAttempts).set({
              errorScope: classified.scope,
              errorCode: classified.category,
              errorMessage: classified.internalMessage,
              retryable: classified.retryable,
            }).where(eq(requestAttempts.id, attemptLogId));

            // Apply credential state based on error
            if (classified.action === 'next_credential' || classified.action === 'next_target') {
              if (classified.scope === 'credential') {
                if (upstreamResponse.status === 402) {
                  await this.providerService.markCredentialExhausted(credential.id, upstreamResponse.status, classified.category);
                } else if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
                  if (upstreamResponse.status === 401) {
                    await this.providerService.markCredentialInvalid(credential.id, upstreamResponse.status, classified.category);
                  }
                  // 403 may be gated model, don't mark credential invalid
                } else if (classified.cooldownMs) {
                  await this.providerService.markCredentialCooldown(credential.id, classified.cooldownMs, upstreamResponse.status, classified.category);
                }
              }

              streamManager.broadcast({
                type: 'key_failed',
                requestId,
                keyId: credential.id,
                label: credential.name,
                statusCode: upstreamResponse.status,
                keyStatus: classified.category,
                errorMessage: classified.publicMessage,
                attempt: attempts,
                timestamp: Date.now(),
              });
              streamManager.broadcast({
                type: 'failover_attempted',
                requestId,
                keyId: credential.id,
                label: credential.name,
                attempt: attempts,
                timestamp: Date.now(),
              });

              failoverCount++;
              if (classified.action === 'next_target') break; // Move to next target
              continue; // Try next credential on same target
            }

            // retry_same_target — continue loop (same credential set, but new attempt)
            if (classified.action === 'retry_same_target') {
              if (classified.cooldownMs) {
                await this.providerService.markCredentialCooldown(credential.id, classified.cooldownMs, upstreamResponse.status, classified.category);
              }
              failoverCount++;
              continue;
            }

            // fail_client
            await this.finalizeLog(logId, upstreamResponse.status, Date.now() - startTime, failoverCount > 0, target.providerId);
            return reply.status(upstreamResponse.status).send(errorBody) as unknown as OrchestratorResult;
          }

          // ── Success ─────────────────────────────────────────
          await this.providerService.markCredentialSuccess(credential.id);

          // Check for low-credit in body
          let responseBodyText = '';
          if (upstreamResponse.body) {
            if (isStreaming) {
              // Handle streaming
              return await this.handleStreamingResponse(
                reply, upstreamResponse, logId, requestId, model,
                target, credential, attempts, failoverCount,
                startTime, adapter as any, canonicalRequest, ingressProtocol,
              );
            }

            responseBodyText = await upstreamResponse.text();
            let responseBodyParsed: unknown;
            try { responseBodyParsed = JSON.parse(responseBodyText); } catch { responseBodyParsed = null; }

            if (isLowCreditError(responseBodyParsed ?? responseBodyText)) {
              await this.providerService.markCredentialExhausted(credential.id, upstreamResponse.status, 'Low credit detected');
              failoverCount++;
              continue;
            }

            // Extract usage and cost
            const usage = extractTokenUsage(responseBodyParsed);
            const cost = calculateCost(model, usage.inputTokens, usage.outputTokens);

            // Forward response
            for (const [key, value] of upstreamResponse.headers.entries()) {
              if (key.toLowerCase() === 'content-encoding') continue;
              void reply.header(key, value);
            }
            reply.header('content-type', upstreamResponse.headers.get('content-type') || 'application/json');
            reply.status(upstreamResponse.status);
            reply.send(responseBodyText);

            await this.finalizeLog(logId, upstreamResponse.status, Date.now() - startTime, failoverCount > 0, target.providerId, {
              usage,
              cost,
              upstreamModelId: target.upstreamModelId,
              routeId: route.routeId,
              credentialId: credential.id,
            });

            streamManager.broadcast({
              type: 'request_completed',
              requestId,
              keyId: credential.id,
              label: credential.name,
              model: target.upstreamModelId,
              tokens: usage.totalTokens,
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              cost,
              success: true,
              statusCode: upstreamResponse.status,
              attempt: attempts,
              fallback: failoverCount > 0,
              timestamp: Date.now(),
            });

            return {
              success: true,
              statusCode: upstreamResponse.status,
              responseBody: responseBodyText,
              responseBodyParsed,
              usage,
              cost,
              requestLogId: logId,
            };
          }

          // No body response
          reply.status(upstreamResponse.status);
          for (const [key, value] of upstreamResponse.headers.entries()) {
            if (key.toLowerCase() === 'content-encoding') continue;
            void reply.header(key, value);
          }
          await this.finalizeLog(logId, upstreamResponse.status, Date.now() - startTime, failoverCount > 0, target.providerId);
          reply.send();

          return { success: true, statusCode: upstreamResponse.status, requestLogId: logId };

        } catch (err) {
          const error = err as Error;
          const classified = classifyNetworkError(error);
          lastError = classified;

          await this.providerService.markCredentialCooldown(
            credential.id,
            classified.cooldownMs ?? 5000,
            0,
            classified.category,
          );

          await this.db.insert(requestAttempts).values({
            id: attemptLogId,
            requestLogId: logId,
            attemptNumber: attempts,
            routeId: route.routeId,
            routeTargetId: target.routeTargetId,
            providerId: target.providerId,
            credentialId: credential.id,
            upstreamModelId: target.upstreamModelId,
            startedAt: new Date(attemptStartTime),
            completedAt: new Date(),
            latencyMs: Date.now() - attemptStartTime,
            httpStatus: 0,
            result: 'error',
            errorScope: classified.scope,
            errorCode: classified.category,
            errorMessage: classified.internalMessage,
            retryable: classified.retryable,
            responseStarted: false,
          });

          streamManager.broadcast({
            type: 'key_failed',
            requestId,
            keyId: credential.id,
            label: credential.name,
            statusCode: 0,
            keyStatus: classified.category,
            errorMessage: classified.publicMessage,
            attempt: attempts,
            timestamp: Date.now(),
          });

          failoverCount++;
          continue;
        }
      }
    }

    // All attempts exhausted
    await this.finalizeLog(logId, 503, Date.now() - startTime, true, null);

    streamManager.broadcast({
      type: 'request_completed',
      requestId,
      model,
      success: false,
      statusCode: 503,
      errorMessage: lastError?.publicMessage ?? 'All providers failed',
      attempt: attempts,
      timestamp: Date.now(),
    });

    return reply.status(503).send({
      error: 'Service Unavailable',
      message: lastError?.publicMessage ?? 'All providers failed after maximum attempts',
    }) as unknown as OrchestratorResult;
  }

  // ── Streaming handler ─────────────────────────────────────

  private async handleStreamingResponse(
    reply: FastifyReply,
    upstreamResponse: Response,
    logId: string,
    requestId: string,
    model: string,
    target: ResolvedTarget,
    credential: DecryptedProviderCredential,
    attempts: number,
    failoverCount: number,
    startTime: number,
    adapter: any,
    canonicalRequest: CanonicalRequest,
    ingressProtocol: IngressProtocol,
  ): Promise<OrchestratorResult> {
    streamManager.broadcast({
      type: 'streaming_started',
      requestId,
      keyId: credential.id,
      label: credential.name,
      model: target.upstreamModelId,
      streaming: true,
      attempt: attempts,
      timestamp: Date.now(),
    });

    // Hijack AFTER confirming success — no retry after this point
    reply.hijack();
    const rawRes = reply.raw;

    rawRes.statusCode = upstreamResponse.status;
    for (const [key, value] of upstreamResponse.headers.entries()) {
      if (key.toLowerCase() === 'content-encoding') continue;
      rawRes.setHeader(key, value);
    }
    rawRes.setHeader('X-Accel-Buffering', 'no');
    rawRes.setHeader('Cache-Control', 'no-cache');
    rawRes.setHeader('Connection', 'keep-alive');

    const reader = upstreamResponse.body!.getReader();
    rawRes.on('close', () => reader.cancel().catch(() => {}));

    let lastChunks: string[] = [];
    const MAX_BUFFER_CHUNKS = 5;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        rawRes.write(chunk);

        if (lastChunks.length >= MAX_BUFFER_CHUNKS) lastChunks.shift();
        lastChunks.push(chunk.toString('utf-8'));
      }
    } catch (err) {
      // After streaming started, NO RETRY — data already sent to client
    } finally {
      reader.releaseLock();
    }

    // Extract usage from buffered SSE chunks
    const usage = this.extractUsageFromChunks(lastChunks);
    const cost = calculateCost(model, usage.inputTokens, usage.outputTokens);

    await this.finalizeLog(logId, upstreamResponse.status, Date.now() - startTime, failoverCount > 0, target.providerId, {
      usage,
      cost,
      upstreamModelId: target.upstreamModelId,
      routeId: null,
      credentialId: credential.id,
    });

    streamManager.broadcast({
      type: 'streaming_completed',
      requestId,
      keyId: credential.id,
      label: credential.name,
      model: target.upstreamModelId,
      tokens: usage.totalTokens,
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      cost,
      success: true,
      statusCode: upstreamResponse.status,
      streaming: true,
      attempt: attempts,
      fallback: failoverCount > 0,
      timestamp: Date.now(),
    });

    streamManager.broadcast({
      type: 'request_completed',
      requestId,
      keyId: credential.id,
      label: credential.name,
      model: target.upstreamModelId,
      tokens: usage.totalTokens,
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      cost,
      success: true,
      streaming: true,
      attempt: attempts,
      fallback: failoverCount > 0,
      timestamp: Date.now(),
    });

    rawRes.end();
    return { success: true, statusCode: upstreamResponse.status, usage, cost, requestLogId: logId };
  }

  private extractUsageFromChunks(chunks: string[]): NormalizedUsage {
    for (const chunk of chunks) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const usage = extractTokenUsage(data);
            if (usage.totalTokens > 0) return usage;
          } catch { /* ignore parse errors */ }
        }
      }
    }
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  // ── Log finalization ──────────────────────────────────────

  private async finalizeLog(
    logId: string,
    statusCode: number,
    latencyMs: number,
    fallback: boolean,
    providerId: string | null,
    extras?: {
      usage?: NormalizedUsage;
      cost?: number;
      upstreamModelId?: string;
      routeId?: string | null;
      credentialId?: string;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      statusCode,
      latencyMs,
      fallback,
    };
    if (providerId) update.finalProviderId = providerId;
    if (extras?.usage) {
      update.promptTokens = extras.usage.inputTokens;
      update.completionTokens = extras.usage.outputTokens;
      update.totalTokens = extras.usage.totalTokens;
      update.cachedTokens = extras.usage.cachedInputTokens ?? 0;
    }
    if (extras?.cost !== undefined) update.estimatedCost = extras.cost;
    if (extras?.upstreamModelId) update.upstreamModelId = extras.upstreamModelId;
    if (extras?.routeId) update.routeId = extras.routeId;
    if (extras?.credentialId) update.finalCredentialId = extras.credentialId;

    await this.db.update(requestLogs).set(update).where(eq(requestLogs.id, logId));
  }
}

// Need to import eq for the where clause
import { eq } from 'drizzle-orm';
