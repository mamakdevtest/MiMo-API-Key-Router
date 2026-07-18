/**
 * Provider validation / auto-detection service.
 * Given a base URL and connection details, verifies the provider is reachable,
 * authenticates, lists models, tests streaming, and builds a capability profile.
 * Used by the dashboard "Test Connection" flow before a provider is saved.
 */

import { validateProviderUrl } from '../security/url-validator.js';
import type { ProviderCapabilities } from '../providers/types.js';

export interface ProviderValidationInput {
  baseUrl: string;
  authHeader?: string;
  authPrefix?: string;
  modelsEndpoint?: string;
  chatCompletionsEndpoint?: string;
  secret?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProviderValidationResult {
  urlSafe: boolean;
  modelsReachable: boolean;
  authValid: boolean | null; // null when no secret supplied
  streamingWorks: boolean | null; // null when it couldn't be tested
  modelsCount: number | null;
  capabilities: ProviderCapabilities;
  errors: string[];
  warnings: string[];
}

export class ProviderValidationService {
  async validate(input: ProviderValidationInput): Promise<ProviderValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const timeout = input.timeoutMs ?? 15000;

    const authHeader = input.authHeader || 'Authorization';
    const authPrefix = input.authPrefix ?? 'Bearer ';
    const modelsEndpoint = input.modelsEndpoint || '/models';
    const chatEndpoint = input.chatCompletionsEndpoint || '/chat/completions';

    // 1. URL safety (SSRF)
    const urlCheck = await validateProviderUrl(input.baseUrl);
    if (!urlCheck.safe) {
      return {
        urlSafe: false,
        modelsReachable: false,
        authValid: null,
        streamingWorks: null,
        modelsCount: null,
        capabilities: this.defaultCapabilities(),
        errors: [urlCheck.error ?? 'URL is not safe'],
        warnings,
      };
    }

    const base = input.baseUrl.endsWith('/') ? input.baseUrl : `${input.baseUrl}/`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(input.customHeaders ?? {}),
    };
    if (input.secret) {
      headers[authHeader] = `${authPrefix}${input.secret}`;
    }

    // 2–4. Models endpoint reachability + auth + model list
    let modelsReachable = false;
    let authValid: boolean | null = input.secret ? null : null;
    let modelsCount: number | null = null;
    let sampleModel: string | null = null;

    try {
      const res = await fetch(new URL(modelsEndpoint.replace(/^\//, ''), base).toString(), {
        headers,
        signal: AbortSignal.timeout(timeout),
      });

      if (res.status === 401 || res.status === 403) {
        authValid = false;
        errors.push('Authentication failed (invalid API key)');
      } else if (res.status >= 400) {
        errors.push(`Models endpoint returned HTTP ${res.status}`);
      } else {
        modelsReachable = true;
        if (input.secret) authValid = true;

        try {
          const data = (await res.json()) as any;
          const list: any[] = Array.isArray(data) ? data : data.data ?? [];
          modelsCount = list.length;
          const first = list[0];
          sampleModel = typeof first === 'string' ? first : first?.id ?? null;
        } catch {
          warnings.push('Models endpoint did not return valid JSON');
        }
      }
    } catch (err) {
      errors.push(`Models endpoint unreachable: ${(err as Error).message}`);
    }

    // 5. Streaming test (only if models are reachable and we have a model to try)
    let streamingWorks: boolean | null = null;
    if (modelsReachable && sampleModel && input.secret) {
      streamingWorks = await this.testStreaming(base, chatEndpoint, headers, sampleModel, timeout, warnings);
    } else if (modelsReachable && !input.secret) {
      warnings.push('Skipping streaming test: no API key provided');
    }

    // 6. Capability profile
    const capabilities: ProviderCapabilities = {
      supportsChat: modelsReachable,
      supportsTextCompletion: false,
      supportsEmbeddings: false,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: streamingWorks === true,
      supportsReasoning: false,
    };

    if (!modelsReachable) {
      warnings.push('Could not build a capability profile — verify base URL and endpoints');
    }

    return {
      urlSafe: true,
      modelsReachable,
      authValid,
      streamingWorks,
      modelsCount,
      capabilities,
      errors,
      warnings,
    };
  }

  private async testStreaming(
    base: string,
    chatEndpoint: string,
    headers: Record<string, string>,
    model: string,
    timeout: number,
    warnings: string[],
  ): Promise<boolean> {
    try {
      const res = await fetch(new URL(chatEndpoint.replace(/^\//, ''), base).toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: true,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok || !res.body) {
        warnings.push(`Streaming test returned HTTP ${res.status}`);
        return false;
      }

      // Read the first chunk to confirm a stream actually starts
      const reader = res.body.getReader();
      const { value } = await reader.read();
      await reader.cancel().catch(() => {});
      return value !== undefined && value.length > 0;
    } catch (err) {
      warnings.push(`Streaming test failed: ${(err as Error).message}`);
      return false;
    }
  }

  private defaultCapabilities(): ProviderCapabilities {
    return {
      supportsChat: false,
      supportsTextCompletion: false,
      supportsEmbeddings: false,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: false,
      supportsReasoning: false,
    };
  }
}
