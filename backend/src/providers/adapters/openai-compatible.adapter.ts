/**
 * Generic OpenAI-compatible provider adapter.
 * Used for custom providers added from the dashboard without writing code.
 * All connection details (base URL, auth header/prefix, endpoints, custom headers,
 * timeout) are read from the provider instance configuration.
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
  CredentialTestResult,
  ValidationResult,
  UpstreamRequest,
  CanonicalResponse,
  ClassifiedProviderError,
  NormalizedUsage,
  ProviderModelPage,
} from '../types.js';
import { classifyHttpError, classifyNetworkError } from '../../routing/error-classifier.js';
import { extractTokenUsage } from '../../usage/usage-normalizer.js';
import { parseCustomHeaders } from '../../security/custom-headers.js';

/**
 * Conservative per-instance capabilities. Chat is assumed (it's the minimum viable
 * OpenAI-compatible surface); everything else is read from the instance's stored
 * capability profile (capabilities_json), falling back to false.
 */
function instanceCapabilities(provider: ProviderInstance): ProviderCapabilities {
  const fallback: ProviderCapabilities = {
    supportsChat: true,
    supportsTextCompletion: false,
    supportsEmbeddings: !!provider.embeddingsEndpoint,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    supportsReasoning: false,
  };

  if (!provider.capabilitiesJson) return fallback;
  try {
    const parsed = JSON.parse(provider.capabilitiesJson);
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly type = 'openai_compatible' as const;

  // Static adapter-level capabilities: chat + streaming are the only safe assumptions.
  readonly capabilities: ProviderCapabilities = {
    supportsChat: true,
    supportsTextCompletion: false,
    supportsEmbeddings: false,
    supportsVision: false,
    supportsTools: false,
    supportsStreaming: true,
    supportsReasoning: false,
  };

  async validateConfig(config: ProviderConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('baseUrl is required');
    if (config.baseUrl && !/^https?:\/\//.test(config.baseUrl)) {
      errors.push('baseUrl must start with http:// or https://');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  async testCredential(
    provider: ProviderInstance,
    credential: DecryptedProviderCredential,
  ): Promise<CredentialTestResult> {
    try {
      const headers = this.buildAuthHeaders(provider, credential.secret);
      const url = this.endpointUrl(provider, provider.modelsEndpoint || '/models');
      const res = await fetch(url, {
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
    const url = this.endpointUrl(context.provider, context.provider.chatCompletionsEndpoint || '/chat/completions');
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);

    const req = context.canonicalRequest;
    const body: Record<string, unknown> = {
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

    const caps = instanceCapabilities(context.provider);
    if (req.tools && caps.supportsTools) body.tools = req.tools;
    if (req.toolChoice && caps.supportsTools) body.tool_choice = req.toolChoice;
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
      return classifyHttpError(context.httpStatus, context.responseBody, 'openai_compatible');
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
    const headers = this.buildAuthHeaders(context.provider, context.credential.secret);
    const url = this.endpointUrl(context.provider, context.provider.modelsEndpoint || '/models');
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(context.provider.timeoutMs ?? 30000) });
    if (!res.ok) throw new Error(`Models endpoint returned ${res.status}`);
    const data = (await res.json()) as any;

    const list: any[] = Array.isArray(data) ? data : data.data ?? [];
    const caps = instanceCapabilities(context.provider);

    const allModels = list.map((m: any) => {
      const upstreamModelId = typeof m === 'string' ? m : m.id;
      const normalizedId = String(upstreamModelId ?? '').toLowerCase();
      // OpenAI-compatible `/models` responses often omit capabilities. Avoid
      // sending chat benchmark calls to clearly non-chat model families.
      const supportsChat = !/(embedding|rerank|moderation|tts|speech|audio|whisper|image|dall-e|video|(^|[\/_-])wan[\/_-])/.test(normalizedId);

      return {
      upstreamModelId,
      displayName: typeof m === 'string' ? m : m.name ?? upstreamModelId ?? null,
      modelClass: null,
      status: 'active',
      contextLength: typeof m === 'object' ? m.context_length ?? m.context_window ?? null : null,
      maxCompletionTokens: typeof m === 'object' ? m.max_completion_tokens ?? m.max_tokens ?? null : null,
      isGated: false,
      availableOnCurrentPlan: true,
      // The endpoint usually omits capabilities; this safe heuristic can be
      // refined through a provider-specific adapter in the future.
      supportsChat,
      supportsTools: caps.supportsTools,
      supportsVision: caps.supportsVision,
      supportsEmbeddings: false,
    };
    });

    // Many OpenAI-compatible APIs return their entire catalog without paging.
    // Paginate locally so ModelSyncService does not repeatedly process the same
    // catalog until its safety limit is reached.
    const start = (context.page - 1) * context.perPage;
    const models = allModels.slice(start, start + context.perPage);

    return {
      models,
      totalCount: allModels.length,
      page: context.page,
      perPage: context.perPage,
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private endpointUrl(provider: ProviderInstance, endpoint: string): string {
    const base = provider.baseUrl.endsWith('/') ? provider.baseUrl : `${provider.baseUrl}/`;
    return new URL(endpoint.replace(/^\//, ''), base).toString();
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
