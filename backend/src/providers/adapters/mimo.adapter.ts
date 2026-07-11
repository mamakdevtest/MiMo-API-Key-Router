/**
 * MiMo provider adapter.
 * Translates canonical requests to MiMo's OpenAI-compatible and Anthropic-compatible upstream APIs.
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
  CredentialTestResult,
  ValidationResult,
  UpstreamRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ClassifiedProviderError,
  NormalizedUsage,
  ProviderPlanContext,
  ProviderConcurrencyContext,
  ProviderPlanSnapshot,
  ProviderConcurrencySnapshot,
} from '../types.js';
import { classifyHttpError, classifyNetworkError, isLowCreditError } from '../../routing/error-classifier.js';
import { extractTokenUsage } from '../../usage/usage-normalizer.js';

const MIMO_PRICING: Record<string, { input: number; output: number }> = {
  'mimo-v2.5-pro': { input: 0.435, output: 0.87 },
  'mimo-v2.5': { input: 0.14, output: 0.28 },
  'mimo-v2.5-asr': { input: 0.074, output: 0 },
  'mimo-v2.5-tts': { input: 0, output: 0 },
  'mimo-v2.5-tts-voiceclone': { input: 0, output: 0 },
  'mimo-v2.5-tts-voicedesign': { input: 0, output: 0 },
};

const ANTHROPIC_ALLOWLIST = new Set([
  'anthropic-version', 'anthropic-beta', 'x-claude-code-*',
  'content-type', 'accept',
]);

function isAnthropicHeaderAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  if (ANTHROPIC_ALLOWLIST.has(lower)) return true;
  if (lower.startsWith('anthropic-')) return true;
  if (lower.startsWith('x-claude-code-')) return true;
  return false;
}

export class MiMoAdapter implements ProviderAdapter {
  readonly type = 'mimo' as const;

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
      const providerConfig = this.getConfig(provider);
      const url = `${providerConfig.baseUrl}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [providerConfig.authHeader]: `${providerConfig.authPrefix}${credential.secret}`,
        },
        body: JSON.stringify({
          model: 'mimo-v2.5',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.status >= 200 && res.status < 300) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { success: false, message: `Connection failed: ${(err as Error).message}` };
    }
  }

  async buildUpstreamRequest(context: ProviderRequestContext): Promise<UpstreamRequest> {
    const providerConfig = this.getConfig(context.provider);
    const isIngressAnthropic = context.ingressProtocol === 'anthropic';

    const url = isIngressAnthropic
      ? `${providerConfig.anthropicBaseUrl}/v1/messages`
      : `${providerConfig.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [providerConfig.authHeader]: `${providerConfig.authPrefix}${context.credential.secret}`,
    };

    // For Anthropic ingress, only forward allowed headers
    if (isIngressAnthropic) {
      // Auth handled above
    }

    // Build the body based on ingress protocol
    const body = isIngressAnthropic
      ? this.buildAnthropicBody(context)
      : this.buildOpenAIBody(context);

    return { url, method: 'POST', headers, body: JSON.stringify(body) };
  }

  private buildOpenAIBody(context: ProviderRequestContext): Record<string, unknown> {
    const req = context.canonicalRequest;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
    };
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop) body.stop = req.stop;
    if (req.stream) body.stream = true;
    if (req.tools) body.tools = req.tools;
    if (req.toolChoice) body.tool_choice = req.toolChoice;
    return body;
  }

  private buildAnthropicBody(context: ProviderRequestContext): Record<string, unknown> {
    const req = context.canonicalRequest;
    const systemMessages = req.messages.filter(m => m.role === 'system');
    const nonSystemMessages = req.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: req.model,
      messages: nonSystemMessages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content,
      })),
      max_tokens: req.maxTokens ?? 4096,
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join('\n\n');
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop) body.stop_sequences = req.stop;
    if (req.stream) body.stream = true;
    if (req.tools) {
      body.tools = req.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    return body;
  }

  async parseNonStreamingResponse(context: ProviderResponseContext): Promise<CanonicalResponse> {
    const body = context.upstreamBody as any;
    if (!body) return { id: 'unknown', model: 'unknown', content: null, toolCalls: null, finishReason: null, usage: null };

    // Anthropic format
    if (body.content !== undefined && Array.isArray(body.content)) {
      const textBlocks = body.content.filter((b: any) => b.type === 'text');
      const toolBlocks = body.content.filter((b: any) => b.type === 'tool_use');
      return {
        id: body.id ?? 'unknown',
        model: body.model ?? 'unknown',
        content: textBlocks.map((b: any) => b.text).join('') || null,
        toolCalls: toolBlocks.length > 0 ? toolBlocks.map((t: any) => ({
          id: t.id,
          type: 'function' as const,
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        })) : null,
        finishReason: body.stop_reason ?? null,
        usage: body.usage ? {
          inputTokens: body.usage.input_tokens ?? 0,
          outputTokens: body.usage.output_tokens ?? 0,
          totalTokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0),
          cachedInputTokens: body.usage.cache_read_input_tokens,
        } : null,
        raw: body,
      };
    }

    // OpenAI format
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
        cachedInputTokens: body.usage.prompt_tokens_details?.cached_tokens,
      } : null,
      raw: body,
    };
  }

  async classifyError(context: ProviderErrorContext): Promise<ClassifiedProviderError> {
    if (context.httpStatus) {
      return classifyHttpError(context.httpStatus, context.responseBody, 'mimo');
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

  private getConfig(provider: ProviderInstance) {
    let extra: Record<string, string> = {};
    if (provider.configJson) {
      try { extra = JSON.parse(provider.configJson); } catch {}
    }
    return {
      baseUrl: provider.baseUrl || 'https://api.xiaomimimo.com/v1',
      anthropicBaseUrl: extra.anthropicBaseUrl || 'https://api.xiaomimimo.com/anthropic',
      authHeader: extra.authHeader || 'Authorization',
      authPrefix: extra.authPrefix || 'Bearer ',
    };
  }
}
