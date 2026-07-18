/**
 * OrcaRouter provider adapter.
 * OpenAI-compatible upstream. OrcaRouter performs its own upstream model routing —
 * the gateway passes provider-prefixed model IDs (e.g. "anthropic/claude-sonnet-4.6")
 * and router aliases (e.g. "orcarouter/auto") through unchanged.
 *
 * Base URL: https://api.orcarouter.ai/v1
 * Auth: Authorization: Bearer <API_KEY>
 */

import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfig,
  ProviderInstance,
  DecryptedProviderCredential,
  ProviderRequestContext,
  ProviderResponseContext,
  ProviderErrorContext,
  UsageExtractionContext,
  ProviderModelListContext,
  ProviderModelDetailContext,
  CredentialTestResult,
  ValidationResult,
  UpstreamRequest,
  CanonicalResponse,
  ClassifiedProviderError,
  NormalizedUsage,
  ProviderModelPage,
  ProviderModelDetail,
} from '../types.js';
import { classifyHttpError, classifyNetworkError } from '../../routing/error-classifier.js';
import { extractTokenUsage } from '../../usage/usage-normalizer.js';
import { parseCustomHeaders } from '../../security/custom-headers.js';

const DEFAULT_BASE_URL = 'https://api.orcarouter.ai/v1';

export class OrcaRouterAdapter implements ProviderAdapter {
  readonly type = 'orcarouter' as const;

  readonly capabilities: ProviderCapabilities = {
    supportsChat: true,
    supportsTextCompletion: false,
    supportsEmbeddings: false,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
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
      const baseUrl = provider.baseUrl || DEFAULT_BASE_URL;
      const headers = this.buildAuthHeaders(provider, credential.secret);

      const res = await fetch(this.endpointUrl(provider, baseUrl, provider.modelsEndpoint || '/models'), {
        headers,
        signal: AbortSignal.timeout(provider.timeoutMs ?? 15000),
      });

      if (res.status === 401 || res.status === 403) {
        return { success: false, message: 'Invalid API key' };
      }
      if (res.status >= 400) {
        return { success: false, message: `HTTP ${res.status}` };
      }

      return { success: true, message: 'Connection successful' };
    } catch (err) {
      return { success: false, message: `Connection failed: ${(err as Error).message}` };
    }
  }

  async buildUpstreamRequest(context: ProviderRequestContext): Promise<UpstreamRequest> {
    const baseUrl = context.provider.baseUrl || DEFAULT_BASE_URL;
    const url = this.endpointUrl(context.provider, baseUrl, context.provider.chatCompletionsEndpoint || '/chat/completions');
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const req = context.canonicalRequest;
    const body: Record<string, unknown> = {
      // Model ID is passed through unchanged — OrcaRouter handles its own
      // upstream routing for prefixed IDs and router aliases like "orcarouter/auto".
      model: req.model,
      messages: req.messages.map((m) => {
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
    if (req.responseFormat) body.response_format = this.mapResponseFormat(req.responseFormat);

    return { url, method: 'POST', headers, body: JSON.stringify(body) };
  }

  async parseNonStreamingResponse(context: ProviderResponseContext): Promise<CanonicalResponse> {
    const body = context.upstreamBody as any;
    if (!body) {
      return { id: 'unknown', model: 'unknown', content: null, toolCalls: null, finishReason: null, usage: null };
    }

    const choice = body.choices?.[0];
    return {
      id: body.id ?? 'unknown',
      model: body.model ?? 'unknown',
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: body.usage
        ? {
            inputTokens: body.usage.prompt_tokens ?? 0,
            outputTokens: body.usage.completion_tokens ?? 0,
            totalTokens: body.usage.total_tokens ?? 0,
          }
        : null,
      raw: body,
    };
  }

  async classifyError(context: ProviderErrorContext): Promise<ClassifiedProviderError> {
    if (context.httpStatus) {
      return classifyHttpError(context.httpStatus, context.responseBody, 'orcarouter');
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
    const baseUrl = context.provider.baseUrl || DEFAULT_BASE_URL;
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const url = this.endpointUrl(context.provider, baseUrl, context.provider.modelsEndpoint || '/models');
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(context.provider.timeoutMs ?? 30000) });
    if (!res.ok) throw new Error(`OrcaRouter models endpoint returned ${res.status}`);
    const data = (await res.json()) as any;

    const models = (data.data ?? []).map((m: any) => ({
      upstreamModelId: m.id,
      displayName: m.name ?? m.id ?? null,
      modelClass: null,
      status: 'active',
      contextLength: m.context_length ?? m.context_window ?? null,
      maxCompletionTokens: m.max_completion_tokens ?? m.max_tokens ?? null,
      isGated: false,
      availableOnCurrentPlan: true,
    }));

    return {
      models,
      totalCount: models.length,
      page: 1,
      perPage: models.length || context.perPage,
    };
  }

  async getModel(context: ProviderModelDetailContext): Promise<ProviderModelDetail> {
    const baseUrl = context.provider.baseUrl || DEFAULT_BASE_URL;
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const base = (context.provider.modelsEndpoint || '/models').replace(/\/$/, '');
    const encodedId = encodeURIComponent(context.modelId);
    const url = this.endpointUrl(context.provider, baseUrl, `${base}/${encodedId}`);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(context.provider.timeoutMs ?? 15000) });
    if (!res.ok) throw new Error(`OrcaRouter model ${context.modelId} returned ${res.status}`);
    const m = (await res.json()) as any;

    return {
      upstreamModelId: m.id ?? context.modelId,
      displayName: m.name ?? m.id ?? context.modelId,
      modelClass: null,
      status: 'active',
      availabilityTier: null,
      contextLength: m.context_length ?? m.context_window ?? null,
      maxCompletionTokens: m.max_completion_tokens ?? m.max_tokens ?? null,
      concurrencyCost: 1,
      isGated: false,
      availableOnCurrentPlan: true,
      supportsTools: this.capabilities.supportsTools,
      supportsVision: this.capabilities.supportsVision,
      supportsChat: true,
      supportsTextCompletion: false,
      supportsEmbeddings: false,
      inputModalities: ['text'],
      outputModalities: ['text'],
      tasks: [],
      pricing: { prompt: null, completion: null, image: null, request: null },
      metadata: { ownedBy: m.owned_by },
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private endpointUrl(provider: ProviderInstance, baseUrl: string, endpoint: string): string {
    return new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  }

  private buildAuthHeaders(provider: ProviderInstance, secret: string): Record<string, string> {
    const authHeader = provider.authHeader || 'Authorization';
    const authPrefix = provider.authPrefix ?? 'Bearer ';
    const custom = parseCustomHeaders(provider.customHeadersJson);

    return {
      [authHeader]: `${authPrefix}${secret}`,
      'Content-Type': 'application/json',
      ...custom,
    };
  }

  private mapResponseFormat(format: NonNullable<ProviderRequestContext['canonicalRequest']['responseFormat']>): Record<string, unknown> {
    if (format.type === 'json_schema') {
      return { type: 'json_schema', json_schema: format.jsonSchema };
    }
    return { type: format.type };
  }
}
