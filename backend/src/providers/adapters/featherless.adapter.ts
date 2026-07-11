/**
 * Featherless.ai provider adapter.
 * OpenAI-compatible upstream with model catalog, plan, concurrency, tool calling, vision support.
 *
 * API docs: https://featherless.ai/docs/
 */

import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfig,
  ProviderInstance,
  DecryptedProviderCredential,
  ProviderRequestContext,
  ProviderResponseContext,
  StreamChunkContext,
  ProviderErrorContext,
  UsageExtractionContext,
  ProviderModelListContext,
  ProviderModelDetailContext,
  ProviderPlanContext,
  ProviderConcurrencyContext,
  CredentialTestResult,
  ValidationResult,
  UpstreamRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ClassifiedProviderError,
  NormalizedUsage,
  ProviderPlanSnapshot,
  ProviderConcurrencySnapshot,
  ProviderModelPage,
  ProviderModelDetail,
} from '../types.js';
import { classifyHttpError, classifyNetworkError, isLowCreditError } from '../../routing/error-classifier.js';
import { extractTokenUsage } from '../../usage/usage-normalizer.js';

export class FeatherlessAdapter implements ProviderAdapter {
  readonly type = 'featherless' as const;

  readonly capabilities: ProviderCapabilities = {
    supportsChat: true,
    supportsTextCompletion: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: true, // via chat_template_kwargs
  };

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('baseUrl is required');
    return { valid: errors.length === 0, errors, warnings };
  }

  async testCredential(
    provider: ProviderInstance,
    credential: DecryptedProviderCredential,
  ): Promise<CredentialTestResult> {
    try {
      const baseUrl = provider.baseUrl || 'https://api.featherless.ai';
      const headers = this.buildAuthHeaders(provider, credential.secret);

      // Test with /v1/models (lightweight)
      const res = await fetch(new URL('/v1/models?page=1&per_page=1', baseUrl).toString(), {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 401) {
        return { success: false, message: 'Invalid API key' };
      }
      if (res.status >= 400) {
        return { success: false, message: `HTTP ${res.status}` };
      }

      // Try to get plan info
      let plan: ProviderPlanSnapshot | null = null;
      try {
        const planRes = await fetch(new URL('/v1/plan', baseUrl).toString(), {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (planRes.ok) {
          const planData = await planRes.json() as any;
          plan = {
            planId: planData.id ?? null,
            planName: planData.name ?? null,
            maxContextLength: planData.max_context_length ?? null,
            maxModelSize: planData.max_model_size ?? null,
            concurrencyLimit: planData.concurrency ?? null,
            updatedAt: new Date().toISOString(),
          };
        }
      } catch { /* optional */ }

      return { success: true, message: 'Connection successful', plan };
    } catch (err) {
      return { success: false, message: `Connection failed: ${(err as Error).message}` };
    }
  }

  async buildUpstreamRequest(context: ProviderRequestContext): Promise<UpstreamRequest> {
    const baseUrl = context.provider.baseUrl || 'https://api.featherless.ai';
    const url = new URL('/v1/chat/completions', baseUrl).toString();
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const req = context.canonicalRequest;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.toolCalls) msg.tool_calls = m.toolCalls;
        if (m.toolCallId) msg.tool_call_id = m.toolCallId;
        if (m.name) msg.name = m.name;
        return msg;
      }),
    };

    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop) body.stop = req.stop;
    if (req.stream) body.stream = true;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    if (req.extra?.chat_template_kwargs) body.chat_template_kwargs = req.extra.chat_template_kwargs;

    return { url, method: 'POST', headers, body: JSON.stringify(body) };
  }

  async parseNonStreamingResponse(context: ProviderResponseContext): Promise<CanonicalResponse> {
    const body = context.upstreamBody as any;
    if (!body) return { id: 'unknown', model: 'unknown', content: null, toolCalls: null, finishReason: null, usage: null };

    const choice = body.choices?.[0];
    return {
      id: body.id ?? 'unknown',
      model: body.model ?? 'unknown',
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: body.usage ? {
        inputTokens: body.usage.prompt_tokens ?? 0,
        outputTokens: body.usage.completion_tokens ?? 0,
        totalTokens: body.usage.total_tokens ?? 0,
      } : null,
      raw: body,
    };
  }

  async classifyError(context: ProviderErrorContext): Promise<ClassifiedProviderError> {
    if (context.httpStatus) {
      return classifyHttpError(context.httpStatus, context.responseBody, 'featherless');
    }
    if (context.error) {
      return classifyNetworkError(context.error);
    }
    return {
      category: 'unknown_error',
      scope: 'request',
      retryable: false,
      action: 'fail_client',
      publicMessage: 'Request failed',
    };
  }

  async extractUsage(context: UsageExtractionContext): Promise<NormalizedUsage | null> {
    return extractTokenUsage(context.responseBody);
  }

  // ── Model catalog ─────────────────────────────────────────

  async listModels(context: ProviderModelListContext): Promise<ProviderModelPage> {
    const baseUrl = context.provider.baseUrl || 'https://api.featherless.ai';
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const params = new URLSearchParams();
    params.set('page', String(context.page));
    params.set('per_page', String(Math.min(context.perPage, 1000)));

    if (context.filters) {
      for (const [key, value] of Object.entries(context.filters)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          value.forEach(v => params.append(key, String(v)));
        } else {
          params.set(key, String(value));
        }
      }
    }

    const url = new URL(`/v1/models?${params}`, baseUrl).toString();
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Featherless /v1/models returned ${res.status}`);
    const data = await res.json() as any;

    return {
      models: (data.data ?? []).map((m: any) => ({
        upstreamModelId: m.id,
        displayName: m.name ?? null,
        modelClass: m.model_class ?? null,
        status: m.status ?? 'active',
        contextLength: m.context_length ?? null,
        maxCompletionTokens: m.max_completion_tokens ?? null,
        isGated: m.is_gated ?? false,
        availableOnCurrentPlan: m.available_on_current_plan ?? true,
      })),
      totalCount: null, // Featherless doesn't return total count in list
      page: context.page,
      perPage: context.perPage,
    };
  }

  async getModel(context: ProviderModelDetailContext): Promise<ProviderModelDetail> {
    const baseUrl = context.provider.baseUrl || 'https://api.featherless.ai';
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    // Model IDs contain slashes — URL-encode
    const encodedId = encodeURIComponent(context.modelId);
    const url = new URL(`/v1/models/${encodedId}`, baseUrl).toString();
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Featherless /v1/models/${context.modelId} returned ${res.status}`);
    const m = await res.json() as any;

    return {
      upstreamModelId: m.id,
      displayName: m.name ?? null,
      modelClass: m.model_class ?? null,
      status: m.status ?? 'active',
      availabilityTier: m.availability?.tier ?? null,
      contextLength: m.context_length ?? null,
      maxCompletionTokens: m.max_completion_tokens ?? null,
      concurrencyCost: m.concurrency_cost ?? 1,
      isGated: m.is_gated ?? false,
      availableOnCurrentPlan: m.available_on_current_plan ?? true,
      supportsTools: m.features?.tool_use ?? false,
      supportsVision: m.vision_supported ?? false,
      supportsChat: true,
      supportsTextCompletion: true,
      supportsEmbeddings: (m.output_modalities ?? []).includes('embedding'),
      inputModalities: m.input_modalities ?? ['text'],
      outputModalities: m.output_modalities ?? ['text'],
      tasks: m.tasks ?? [],
      pricing: {
        prompt: m.pricing?.prompt ?? null,
        completion: m.pricing?.completion ?? null,
        image: m.pricing?.image ?? null,
        request: m.pricing?.request ?? null,
      },
      metadata: {
        huggingfaceId: m.huggingface_id,
        license: m.license,
        parameterSize: m.parameter_size,
        isMoe: m.is_moe,
        activeParameters: m.active_parameters,
        downloads: m.downloads,
        favorites: m.favorites,
        availability: m.availability,
        tags: m.tags,
      },
    };
  }

  async getPlan(context: ProviderPlanContext): Promise<ProviderPlanSnapshot> {
    const baseUrl = context.provider.baseUrl || 'https://api.featherless.ai';
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const res = await fetch(new URL('/v1/plan', baseUrl).toString(), {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Featherless /v1/plan returned ${res.status}`);
    const data = await res.json() as any;

    return {
      planId: data.id ?? null,
      planName: data.name ?? null,
      maxContextLength: data.max_context_length ?? null,
      maxModelSize: data.max_model_size ?? null,
      concurrencyLimit: data.concurrency ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  async getConcurrency(context: ProviderConcurrencyContext): Promise<ProviderConcurrencySnapshot> {
    const baseUrl = context.provider.baseUrl || 'https://api.featherless.ai';
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    // /account/concurrency is NOT under /v1
    const url = new URL('/account/concurrency', baseUrl).toString();
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Featherless /account/concurrency returned ${res.status}`);
    const data = await res.json() as any;

    return {
      limit: data.limit ?? null,
      usedCost: data.used_cost ?? 0,
      requestCount: data.request_count ?? 0,
      requests: (data.requests ?? []).map((r: any) => ({
        id: r.id,
        cost: r.cost,
        model: r.model,
        startedAt: r.started_at,
        durationMs: r.duration_ms,
      })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private buildAuthHeaders(provider: ProviderInstance, secret: string): Record<string, string> {
    let extra: Record<string, string> = {};
    if (provider.configJson) {
      try { extra = JSON.parse(provider.configJson); } catch {}
    }

    return {
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(extra.httpReferer ? { 'HTTP-Referer': extra.httpReferer } : {}),
      ...(extra.xTitle ? { 'X-Title': extra.xTitle } : {}),
    };
  }
}
