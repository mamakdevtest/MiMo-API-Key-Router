/**
 * Low-cost, per-provider model availability and latency checks.
 * Benchmark calls bypass gateway request logging. Their final per-model result
 * is persisted for UI health reporting, without changing routing decisions.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { modelBenchmarkResults, providerModels } from '../db/schema.js';
import { getAdapter } from '../providers/registry.js';
import { ProviderService } from '../providers/provider-service.js';
import { buildPublicModelId } from '../providers/public-model-id.js';
import type { CanonicalRequest, DecryptedProviderCredential, ProviderInstance } from '../providers/types.js';
import { streamManager } from './stream-manager.js';

export interface ModelBenchmarkResult {
  upstreamModelId: string;
  publicModelId: string;
  credentialName?: string;
  status: 'success' | 'failed';
  latencyMs: number | null;
  httpStatus: number | null;
  /** The Vercel model is reachable, but its free-tier request budget is temporarily limited. */
  rateLimited?: boolean;
  error?: string;
}

export interface ModelBenchmarkReport {
  providerId: string;
  providerName: string;
  credentialName: string;
  concurrency: number;
  results: ModelBenchmarkResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    averageLatencyMs: number | null;
    fastestLatencyMs: number | null;
    slowestLatencyMs: number | null;
  };
}

export interface ModelBenchmarkJob {
  id: string;
  providerId: string;
  providerName: string | null;
  status: 'running' | 'stopping' | 'cancelled' | 'completed' | 'failed';
  total: number;
  completed: number;
  results: ModelBenchmarkResult[];
  summary: ModelBenchmarkReport['summary'];
  error: string | null;
  exhaustedCredentials: string[];
  cancelRequested: boolean;
  startedAt: string;
  completedAt: string | null;
}

const benchmarkJobs = new Map<string, ModelBenchmarkJob>();

export class ModelBenchmarkService {
  private providerService: ProviderService;

  constructor(private db: Db) {
    this.providerService = new ProviderService(db);
  }

  async benchmark(
    providerId: string,
    requestedModelIds?: string[],
    requestedConcurrency = 3,
    requestedLimit = 20,
    allModels = false,
    onProgress?: (total: number, completed: number, result?: ModelBenchmarkResult) => void,
  ): Promise<ModelBenchmarkReport> {
    const provider = await this.providerService.getById(providerId);
    if (!provider) throw new Error('Provider not found');

    const credential = await this.providerService.selectCredential(providerId);
    if (!credential) throw new Error('No active credential is available for this provider');

    const modelIds = [...new Set(requestedModelIds ?? [])];
    const where = modelIds.length > 0
      ? and(eq(providerModels.providerId, providerId), inArray(providerModels.upstreamModelId, modelIds))
      : and(eq(providerModels.providerId, providerId), eq(providerModels.supportsChat, true), eq(providerModels.status, 'active'));

    const models = await this.db.query.providerModels.findMany({
      where,
      orderBy: [asc(providerModels.upstreamModelId)],
      ...(allModels ? {} : { limit: Math.max(1, Math.min(requestedLimit, 100)) }),
    });

    if (models.length === 0) {
      throw new Error('No active chat models found. Synchronize this provider’s models first.');
    }

    const concurrency = Math.max(1, Math.min(requestedConcurrency, 5, models.length));
    const results: ModelBenchmarkResult[] = [];
    let nextIndex = 0;
    onProgress?.(models.length, 0);

    const worker = async () => {
      while (nextIndex < models.length) {
        const model = models[nextIndex++];
        const flowId = crypto.randomUUID();
        this.publishBenchmarkStarted(flowId, provider, model.upstreamModelId, credential);
        const result = await this.benchmarkModel(provider, credential, model.upstreamModelId);
        result.credentialName = credential.name;
        await this.persistResult(model.id, result);
        this.publishBenchmarkCompleted(flowId, provider, result, credential.name);
        results.push(result);
        onProgress?.(models.length, results.length, result);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    results.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'success' ? -1 : 1;
      return (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER);
    });

    return {
      providerId,
      providerName: provider.name,
      credentialName: credential.name,
      concurrency,
      results,
      summary: summarize(results, results.length),
    };
  }

  startSequentialAll(providerId: string): ModelBenchmarkJob {
    const id = crypto.randomUUID();
    const job: ModelBenchmarkJob = {
      id,
      providerId,
      providerName: null,
      status: 'running',
      total: 0,
      completed: 0,
      results: [],
      summary: summarize([], 0),
      error: null,
      exhaustedCredentials: [],
      cancelRequested: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    benchmarkJobs.set(id, job);

    void this.runSequentialAll(job).catch((error) => {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = new Date().toISOString();
    });

    // Jobs are diagnostics; retain completed results briefly for the dashboard.
    setTimeout(() => benchmarkJobs.delete(id), 60 * 60 * 1000).unref();
    return job;
  }

  getJob(jobId: string): ModelBenchmarkJob | null {
    return benchmarkJobs.get(jobId) ?? null;
  }

  cancelJob(jobId: string): ModelBenchmarkJob | null {
    const job = benchmarkJobs.get(jobId);
    if (!job || job.status !== 'running') return job ?? null;
    job.cancelRequested = true;
    job.status = 'stopping';
    return job;
  }

  private async runSequentialAll(job: ModelBenchmarkJob): Promise<void> {
    const provider = await this.providerService.getById(job.providerId);
    if (!provider) throw new Error('Provider not found');
    job.providerName = provider.name;

    const models = await this.db.query.providerModels.findMany({
      where: and(
        eq(providerModels.providerId, job.providerId),
        eq(providerModels.supportsChat, true),
        eq(providerModels.status, 'active'),
      ),
      orderBy: [asc(providerModels.upstreamModelId)],
    });
    if (models.length === 0) throw new Error('No active chat models found. Synchronize this provider’s models first.');

    job.total = models.length;
    let credential = await this.providerService.selectCredential(job.providerId);
    if (!credential) throw new Error('No active credential is available for this provider');

    for (const model of models) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        return;
      }

      let result: ModelBenchmarkResult | null = null;
      if (!credential) {
        throw new Error('No active credential is available for this provider');
      }
      const flowId = crypto.randomUUID();
      this.publishBenchmarkStarted(flowId, provider, model.upstreamModelId, credential);
      const rateLimitedCredentialIds = new Set<string>();
      let rateLimitedPass = 1;
      while (credential) {
        this.publishBenchmarkCredentialSelected(flowId, provider, model.upstreamModelId, credential, rateLimitedPass);
        result = await this.benchmarkModel(provider, credential, model.upstreamModelId);
        result.credentialName = credential.name;

        if (result.rateLimited) {
          // A Vercel free-tier model limit is temporary and is tied to the
          // credential/model pair. Try every active key twice, but never mark
          // the key exhausted or put it in cooldown.
          rateLimitedCredentialIds.add(credential.id);
          const nextCredential = await this.providerService.selectCredential(job.providerId, rateLimitedCredentialIds);
          if (nextCredential) {
            credential = nextCredential;
            continue;
          }
          if (rateLimitedPass < 2) {
            rateLimitedPass += 1;
            rateLimitedCredentialIds.clear();
            credential = await this.providerService.selectCredential(job.providerId, rateLimitedCredentialIds);
            continue;
          }

          // Keep the final limited result as an available model, then start
          // the next model from the normal credential priority order.
          credential = await this.providerService.selectCredential(job.providerId);
          break;
        }

        if (!isInsufficientBalance(result)) break;

        await this.providerService.markCredentialExhausted(
          credential.id,
          result.httpStatus ?? 402,
          result.error ?? 'Insufficient balance detected by model benchmark',
        );
        if (!job.exhaustedCredentials.includes(credential.name)) job.exhaustedCredentials.push(credential.name);
        if (job.cancelRequested) {
          job.status = 'cancelled';
          job.completedAt = new Date().toISOString();
          return;
        }
        credential = await this.providerService.selectCredential(job.providerId);
      }

      if (!result || (isInsufficientBalance(result) && !credential)) {
        result = {
          upstreamModelId: model.upstreamModelId,
          publicModelId: buildPublicModelId(provider, model.upstreamModelId),
          status: 'failed',
          latencyMs: null,
          httpStatus: null,
          error: 'No active credential remains after insufficient-balance failures',
        };
      }

      // Do not write a partial result when cancellation was requested while a
      // model was being tested. Completed models always persist only one final
      // credential/failover outcome.
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        return;
      }
      await this.persistResult(model.id, result);
      this.publishBenchmarkCompleted(flowId, provider, result, result.credentialName);
      job.results.push(result);
      job.completed += 1;
      job.summary = summarize(job.results, job.total);
    }

    job.results.sort(sortBenchmarkResults);
    job.summary = summarize(job.results, job.total);
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
  }

  private async benchmarkModel(
    provider: ProviderInstance,
    credential: DecryptedProviderCredential,
    upstreamModelId: string,
  ): Promise<ModelBenchmarkResult> {
    const publicModelId = buildPublicModelId(provider, upstreamModelId);
    const canonicalRequest: CanonicalRequest = {
      model: upstreamModelId,
      messages: [{ role: 'user', content: 'Reply only: OK' }],
      maxTokens: 1,
      temperature: 0,
      stream: false,
    };

    try {
      const adapter = getAdapter(provider.type);
      const upstreamRequest = await adapter.buildUpstreamRequest({
        provider,
        credential,
        canonicalRequest,
        ingressProtocol: 'openai',
        routeId: null,
        routeTargetId: null,
      });

      const startedAt = performance.now();
      const response = await fetch(upstreamRequest.url, {
        method: upstreamRequest.method,
        headers: upstreamRequest.headers,
        body: upstreamRequest.body,
        signal: AbortSignal.timeout(Math.min(provider.timeoutMs ?? 30000, 30000)),
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (response.ok) {
        await response.arrayBuffer();
        return { upstreamModelId, publicModelId, status: 'success', latencyMs, httpStatus: response.status };
      }

      const responseText = (await response.text()).replace(/\s+/g, ' ').slice(0, 160);
      if (isVercelFreeTierRateLimited(response.status, responseText)) {
        return {
          upstreamModelId,
          publicModelId,
          status: 'success',
          latencyMs: null,
          httpStatus: response.status,
          rateLimited: true,
          error: 'Vercel free-tier requests for this model are rate-limited',
        };
      }
      return {
        upstreamModelId,
        publicModelId,
        status: 'failed',
        latencyMs,
        httpStatus: response.status,
        error: `HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
      };
    } catch (error) {
      return {
        upstreamModelId,
        publicModelId,
        status: 'failed',
        latencyMs: null,
        httpStatus: null,
        error: (error as Error).message.slice(0, 160),
      };
    }
  }

  private async persistResult(providerModelId: string, result: ModelBenchmarkResult): Promise<void> {
    const now = new Date();
    await this.db.insert(modelBenchmarkResults).values({
      providerModelId,
      outcome: result.rateLimited ? 'rate_limited' : result.status === 'success' ? 'success' : 'failed',
      latencyMs: result.latencyMs,
      httpStatus: result.httpStatus,
      errorMessage: result.error?.slice(0, 160) ?? null,
      testedAt: now,
    }).onConflictDoUpdate({
      target: modelBenchmarkResults.providerModelId,
      set: {
        outcome: result.rateLimited ? 'rate_limited' : result.status === 'success' ? 'success' : 'failed',
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        errorMessage: result.error?.slice(0, 160) ?? null,
        testedAt: now,
      },
    });
  }

  private publishBenchmarkStarted(
    requestId: string,
    provider: ProviderInstance,
    upstreamModelId: string,
    credential: DecryptedProviderCredential,
  ) {
    streamManager.broadcast({
      type: 'benchmark_started',
      flowType: 'benchmark',
      requestId,
      providerName: provider.name,
      model: buildPublicModelId(provider, upstreamModelId),
      label: credential.name,
      attempt: 1,
      timestamp: Date.now(),
    });
  }

  private publishBenchmarkCredentialSelected(
    requestId: string,
    provider: ProviderInstance,
    upstreamModelId: string,
    credential: DecryptedProviderCredential,
    attempt: number,
  ) {
    streamManager.broadcast({
      type: 'key_selected',
      flowType: 'benchmark',
      requestId,
      providerName: provider.name,
      model: buildPublicModelId(provider, upstreamModelId),
      label: credential.name,
      attempt,
      timestamp: Date.now(),
    });
  }

  private publishBenchmarkCompleted(
    requestId: string,
    provider: ProviderInstance,
    result: ModelBenchmarkResult,
    credentialName?: string,
  ) {
    streamManager.broadcast({
      type: 'benchmark_completed',
      flowType: 'benchmark',
      requestId,
      providerName: provider.name,
      model: result.publicModelId,
      label: credentialName,
      success: result.status === 'success',
      statusCode: result.httpStatus ?? undefined,
      latencyMs: result.latencyMs,
      errorMessage: result.error,
      attempt: 1,
      timestamp: Date.now(),
    });
  }
}

function isInsufficientBalance(result: ModelBenchmarkResult): boolean {
  if (result.httpStatus === 402) return true;
  return /(insufficient|inadequate)[\s_-]*(balance|credit|funds|quota)|low[\s_-]*(balance|credit)|quota[\s_-]*exceeded|payment[\s_-]*required/i.test(result.error ?? '');
}

function isVercelFreeTierRateLimited(httpStatus: number, responseText: string): boolean {
  return httpStatus === 429 && /free tier requests on this model are rate-limited/i.test(responseText);
}

function sortBenchmarkResults(a: ModelBenchmarkResult, b: ModelBenchmarkResult): number {
  if (a.status !== b.status) return a.status === 'success' ? -1 : 1;
  return (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER);
}

function summarize(results: ModelBenchmarkResult[], total: number): ModelBenchmarkReport['summary'] {
  const successfulLatencies = results
    .filter((result) => result.status === 'success' && result.latencyMs !== null)
    .map((result) => result.latencyMs!);

  return {
    total,
    successful: results.filter((result) => result.status === 'success').length,
    failed: results.filter((result) => result.status === 'failed').length,
    averageLatencyMs: successfulLatencies.length
      ? Math.round(successfulLatencies.reduce((sum, latency) => sum + latency, 0) / successfulLatencies.length)
      : null,
    fastestLatencyMs: successfulLatencies.length ? Math.min(...successfulLatencies) : null,
    slowestLatencyMs: successfulLatencies.length ? Math.max(...successfulLatencies) : null,
  };
}
