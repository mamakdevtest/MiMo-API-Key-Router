/**
 * Provider-agnostic error classifier.
 * Maps HTTP status codes and error patterns to classified errors with recommended actions.
 */

import type { ClassifiedProviderError, ErrorScope, ErrorAction } from '../providers/types.js';

export function classifyHttpError(
  httpStatus: number,
  responseBody?: unknown,
  providerType?: string,
): ClassifiedProviderError {
  const bodyText = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody ?? '');
  const bodyLower = bodyText.toLowerCase();

  switch (httpStatus) {
    case 400: {
      // Featherless cold model returns 400
      if (bodyLower.includes('cold') || bodyLower.includes('not ready') || bodyLower.includes('loading')) {
        return {
          category: 'model_cold',
          scope: 'model',
          retryable: true,
          action: 'next_target',
          cooldownMs: 60_000,
          publicMessage: 'Model is loading, please try again later',
          internalMessage: 'Model cold/not ready',
        };
      }
      return {
        category: 'bad_request',
        scope: 'request',
        retryable: false,
        action: 'fail_client',
        publicMessage: 'Invalid request',
        internalMessage: `400: ${bodyText.slice(0, 200)}`,
      };
    }

    case 401:
      return {
        category: 'auth_failed',
        scope: 'credential',
        retryable: true,
        action: 'next_credential',
        publicMessage: 'Authentication failed',
        internalMessage: '401 Unauthorized',
      };

    case 402:
      return {
        category: 'payment_required',
        scope: 'credential',
        retryable: true,
        action: 'next_credential',
        cooldownMs: 3_600_000,
        publicMessage: 'Insufficient credits',
        internalMessage: '402 Payment Required',
      };

    case 403: {
      // Gated model vs forbidden
      if (bodyLower.includes('gated') || bodyLower.includes('license')) {
        return {
          category: 'model_gated',
          scope: 'model',
          retryable: true,
          action: 'next_target',
          publicMessage: 'Model requires license agreement',
          internalMessage: '403 Gated model',
        };
      }
      return {
        category: 'forbidden',
        scope: 'credential',
        retryable: true,
        action: 'next_credential',
        publicMessage: 'Access denied',
        internalMessage: '403 Forbidden',
      };
    }

    case 404:
      return {
        category: 'model_not_found',
        scope: 'model',
        retryable: true,
        action: 'next_target',
        publicMessage: 'Model not found',
        internalMessage: '404 Not Found',
      };

    case 429: {
      // Featherless concurrency limit vs rate limit
      if (bodyLower.includes('concurrency') || bodyLower.includes('concurrent')) {
        return {
          category: 'concurrency_limited',
          scope: 'provider',
          retryable: true,
          action: 'next_target',
          cooldownMs: 30_000,
          publicMessage: 'Provider at capacity',
          internalMessage: '429 Concurrency limit',
        };
      }
      return {
        category: 'rate_limited',
        scope: 'credential',
        retryable: true,
        action: 'next_credential',
        cooldownMs: 60_000,
        publicMessage: 'Rate limited',
        internalMessage: '429 Rate Limited',
      };
    }

    case 500:
      return {
        category: 'server_error',
        scope: 'request',
        retryable: true,
        action: 'retry_same_target',
        cooldownMs: 10_000,
        publicMessage: 'Provider error',
        internalMessage: '500 Internal Server Error',
      };

    case 503: {
      if (bodyLower.includes('no valid executor') || bodyLower.includes('capacity')) {
        return {
          category: 'capacity_insufficient',
          scope: 'provider',
          retryable: true,
          action: 'retry_same_target',
          cooldownMs: 15_000,
          publicMessage: 'Provider at capacity, retrying',
          internalMessage: '503 No valid executor / insufficient capacity',
        };
      }
      return {
        category: 'service_unavailable',
        scope: 'provider',
        retryable: true,
        action: 'next_target',
        cooldownMs: 30_000,
        publicMessage: 'Provider temporarily unavailable',
        internalMessage: '503 Service Unavailable',
      };
    }

    default:
      if (httpStatus >= 500) {
        return {
          category: 'server_error',
          scope: 'provider',
          retryable: true,
          action: 'retry_same_target',
          cooldownMs: 15_000,
          publicMessage: 'Provider error',
          internalMessage: `${httpStatus} server error`,
        };
      }
      return {
        category: 'unknown_error',
        scope: 'request',
        retryable: false,
        action: 'fail_client',
        publicMessage: 'Request failed',
        internalMessage: `HTTP ${httpStatus}`,
      };
  }
}

export function classifyNetworkError(error: Error): ClassifiedProviderError {
  if (error.name === 'AbortError') {
    return {
      category: 'timeout',
      scope: 'request',
      retryable: true,
      action: 'retry_same_target',
      cooldownMs: 5_000,
      publicMessage: 'Request timed out',
      internalMessage: 'AbortError — request timeout',
    };
  }

  return {
    category: 'network_error',
    scope: 'request',
    retryable: true,
    action: 'next_credential',
    cooldownMs: 5_000,
    publicMessage: 'Network error',
    internalMessage: error.message,
  };
}

export function isLowCreditError(body: unknown): boolean {
  if (!body) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = text.toLowerCase();
  const patterns = [
    'low credit', 'insufficient balance', 'balance not enough',
    'quota exceeded', 'account balance', 'payment required',
    'credits exhausted', 'billing', 'exceeded your current quota',
    'insufficient_quota', 'insufficient funds',
  ];
  return patterns.some((p) => lower.includes(p));
}
