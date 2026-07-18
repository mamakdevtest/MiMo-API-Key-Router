const API_BASE = '';

let csrfTokenCache = '';

export function setCsrfToken(token: string) {
  csrfTokenCache = token;
}

function getCsrfToken(): string {
  if (csrfTokenCache) return csrfTokenCache;
  const match = document.cookie.match(/(?:^|; )admin_session=([^;]*)/);
  return match ? match[1] : '';
}

async function fetchJson<T>(path: string, options: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const hasBody = options.body !== undefined && options.body !== null;
  const method = (options.method || 'GET').toUpperCase();

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      method,
      signal: controller.signal,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        'X-CSRF-Token': getCsrfToken(),
        ...options.headers,
      },
      credentials: 'include',
    });

    clearTimeout(timeout);

    if (res.status === 401 && !path.includes('/admin/me')) {
      window.location.href = '/';
      throw new Error('Unauthorized');
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Backend returned HTML instead of JSON. Is the backend server running?');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. Please check that the backend is running.');
    }
    throw err;
  }
}

async function fetchAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
        ...options.headers,
      },
      credentials: 'include',
    });

    clearTimeout(timeout);

    if (res.status === 401) {
      return { authenticated: false } as T;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Backend returned HTML instead of JSON. Is the backend server running?');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. Please check that the backend is running.');
    }
    throw err;
  }
}

export const api = {
  login: (password: string) => fetchJson<{ success: boolean; csrfToken?: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => fetchJson<{ success: boolean }>('/admin/logout', { method: 'POST', body: '{}' }),
  me: () => fetchAuth<{ authenticated: boolean; csrfToken?: string }>('/admin/me'),
  dashboard: () => fetchJson<{
    gatewayStatus: string;
    totalKeys: number;
    activeKeys: number;
    cooldownKeys: number;
    exhaustedKeys: number;
    requestsLast24h: number;
    successRate: number;
    modelHealth: {
      ready: number;
      rate_limited: number;
      untested: number;
      stale: number;
      failed: number;
      inactive: number;
      total: number;
      retestRecommended: number;
    };
  }>('/admin/dashboard'),
  usage: (period = '24h') => fetchJson<{
    period: string;
    totals: {
      requests: number;
      tokens: number;
      cost: number;
      avgLatency: number;
    };
    byModel: Array<{
      model: string;
      requests: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCost: number;
      avgLatency: number;
    }>;
    byKey: Array<{
      keyId: string;
      label: string;
      requests: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      estimatedCost: number;
      avgLatency: number;
    }>;
    hourly: Array<{
      hour: string;
      requests: number;
      totalTokens: number;
      estimatedCost: number;
    }>;
  }>(`/admin/usage?period=${period}`),
  keys: {
    list: () => fetchJson<Array<{
      id: string;
      label: string;
      maskedKey: string;
      priority: number;
      status: string;
      lastUsedAt: string | null;
      lastErrorCode: number | null;
      lastErrorMessage: string | null;
      lastErrorAt: string | null;
      cooldownUntil: string | null;
      createdAt: string;
      updatedAt: string;
    }>>('/admin/keys'),
    create: (data: { label: string; key: string; priority: number; note?: string }) =>
      fetchJson<{ success: boolean }>('/admin/keys', { method: 'POST', body: JSON.stringify(data) }),
    bulkCreate: (data: { keys: Array<{ label: string; key: string }>; startPriority?: number }) =>
      fetchJson<{ success: boolean; count: number }>('/admin/keys/bulk', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { label?: string; priority?: number; note?: string }) =>
      fetchJson<{ success: boolean }>(`/admin/keys/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}`, { method: 'DELETE' }),
    enable: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/enable`, { method: 'POST', body: '{}' }),
    disable: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/disable`, { method: 'POST', body: '{}' }),
    reset: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/reset`, { method: 'POST', body: '{}' }),
    move: (id: string, direction: 'up' | 'down') =>
      fetchJson<{ success: boolean }>(`/admin/keys/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }),
  },
  settings: {
    get: () => fetchJson<{
      cooldown429Seconds: number;
      cooldown5xxSeconds: number;
      cooldownTimeoutSeconds: number;
      requestTimeoutSeconds: number;
      ipAllowlist: string;
      publicModelIds: string[];
    }>('/admin/settings'),
    update: (data: Partial<{
      cooldown429Seconds: number;
      cooldown5xxSeconds: number;
      cooldownTimeoutSeconds: number;
      requestTimeoutSeconds: number;
      ipAllowlist: string;
      publicModelIds: string[];
    }>) => fetchJson<{ success: boolean }>('/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },
  models: {
    list: () => fetchJson<Array<{
      id: string;
      name: string;
      description: string;
      public: boolean;
      health: ModelHealth;
      benchmark: ModelBenchmark | null;
    }>>('/admin/models'),
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    fetchJson<{ success: boolean }>('/admin/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  logs: {
    list: (limit = 100, offset = 0) =>
      fetchJson<Array<{
        id: string;
        requestId: string;
        timestamp: string;
        route: string;
        model: string | null;
        apiKeyId: string | null;
        statusCode: number | null;
        latencyMs: number;
        streaming: boolean;
        fallback: boolean;
        clientIp: string | null;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        estimatedCost?: number;
      }>>(`/admin/logs?limit=${limit}&offset=${offset}`),
  },
  credentialEncryption: {
    migrate: (legacyKey: string) => fetchJson<{
      success: boolean;
      providerCredentials: number;
      legacyApiKeys: number;
    }>('/admin/credential-encryption/migrate', { method: 'POST', body: JSON.stringify({ legacyKey }) }),
  },
  liveFlow: {
    list: (limit = 20) => fetchJson<Array<{
      id: string;
      requestId: string;
      timestamp: string;
      route: string;
      model: string | null;
      upstreamModelId: string | null;
      providerName: string | null;
      statusCode: number | null;
      latencyMs: number;
      streaming: boolean;
      fallback: boolean;
      clientIp: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
      totalTokens: number | null;
      estimatedCost: number | null;
      attemptCount: number | null;
      failoverCount: number | null;
      attempts: Array<{
        attemptNumber: number;
        providerName: string | null;
        credentialName: string | null;
        upstreamModelId: string | null;
        startedAt: string;
        completedAt: string | null;
        latencyMs: number | null;
        httpStatus: number | null;
        result: string | null;
        errorCode: string | null;
        errorMessage: string | null;
        retryable: boolean;
      }>;
    }>>(`/admin/live-flow?limit=${limit}`),
  },
  // ── Provider management ──────────────────────────────────
  providers: {
    list: () => fetchJson<Array<any>>('/admin/providers'),
    get: (id: string) => fetchJson<any>(`/admin/providers/${id}`),
    create: (data: any) => fetchJson<any>('/admin/providers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => fetchJson<{ success: boolean }>(`/admin/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => fetchJson<{ success: boolean }>(`/admin/providers/${id}`, { method: 'DELETE' }),
    enable: (id: string) => fetchJson<{ success: boolean }>(`/admin/providers/${id}/enable`, { method: 'POST', body: '{}' }),
    disable: (id: string) => fetchJson<{ success: boolean }>(`/admin/providers/${id}/disable`, { method: 'POST', body: '{}' }),
    test: (id: string) => fetchJson<any>(`/admin/providers/${id}/test`, { method: 'POST', body: '{}' }),
    validate: (data: {
      baseUrl: string;
      authHeader?: string;
      authPrefix?: string;
      modelsEndpoint?: string;
      chatCompletionsEndpoint?: string;
      secret?: string;
      customHeaders?: Record<string, string>;
      timeoutMs?: number;
    }) => fetchJson<{
      urlSafe: boolean;
      modelsReachable: boolean;
      authValid: boolean | null;
      streamingWorks: boolean | null;
      modelsCount: number | null;
      capabilities: Record<string, boolean>;
      errors: string[];
      warnings: string[];
    }>('/admin/providers/validate', { method: 'POST', body: JSON.stringify(data) }),
    syncModels: (id: string) => fetchJson<any>(`/admin/providers/${id}/sync-models`, { method: 'POST', body: '{}' }),
    benchmarkModels: (id: string, data: { modelIds?: string[]; concurrency?: number; limit?: number } = {}) =>
      fetchJson<{
        providerId: string;
        providerName: string;
        credentialName: string;
        concurrency: number;
        results: Array<{
          upstreamModelId: string;
          publicModelId: string;
          credentialName?: string;
          status: 'success' | 'failed';
          latencyMs: number | null;
          httpStatus: number | null;
          rateLimited?: boolean;
          error?: string;
        }>;
        summary: {
          total: number;
          successful: number;
          failed: number;
          averageLatencyMs: number | null;
          fastestLatencyMs: number | null;
          slowestLatencyMs: number | null;
        };
      }>(`/admin/providers/${id}/benchmark-models`, { method: 'POST', body: JSON.stringify(data) }, 5 * 60 * 1000),
    benchmarkAllModels: (id: string) => fetchJson<any>(`/admin/providers/${id}/benchmark-all-models`, { method: 'POST', body: '{}' }),
    getBenchmarkJob: (id: string, jobId: string) => fetchJson<any>(`/admin/providers/${id}/benchmark-jobs/${jobId}`),
    cancelBenchmarkJob: (id: string, jobId: string) => fetchJson<any>(`/admin/providers/${id}/benchmark-jobs/${jobId}/cancel`, { method: 'POST', body: '{}' }),
    getPlan: (id: string) => fetchJson<any>(`/admin/providers/${id}/plan`),
    getConcurrency: (id: string) => fetchJson<any>(`/admin/providers/${id}/concurrency`),
    getModels: (id: string) => fetchJson<any[]>(`/admin/providers/${id}/models`),
    credentials: {
      list: (providerId: string) => fetchJson<any[]>(`/admin/providers/${providerId}/credentials`),
      create: (providerId: string, data: any) => fetchJson<any>(`/admin/providers/${providerId}/credentials`, { method: 'POST', body: JSON.stringify(data) }),
      bulkCreate: (providerId: string, data: { credentials: Array<{ name: string; secret: string }>; startPriority?: number }) =>
        fetchJson<{ success: boolean; count: number }>(`/admin/providers/${providerId}/credentials/bulk`, { method: 'POST', body: JSON.stringify(data) }),
      update: (providerId: string, credId: string, data: any) => fetchJson<{ success: boolean }>(`/admin/providers/${providerId}/credentials/${credId}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (providerId: string, credId: string) => fetchJson<{ success: boolean }>(`/admin/providers/${providerId}/credentials/${credId}`, { method: 'DELETE' }),
      test: (providerId: string, credId: string) => fetchJson<any>(`/admin/providers/${providerId}/credentials/${credId}/test`, { method: 'POST', body: '{}' }),
      reset: (providerId: string, credId: string) => fetchJson<{ success: boolean }>(`/admin/providers/${providerId}/credentials/${credId}/reset`, { method: 'POST', body: '{}' }),
      enable: (providerId: string, credId: string) => fetchJson<{ success: boolean }>(`/admin/providers/${providerId}/credentials/${credId}/enable`, { method: 'POST', body: '{}' }),
      disable: (providerId: string, credId: string) => fetchJson<{ success: boolean }>(`/admin/providers/${providerId}/credentials/${credId}/disable`, { method: 'POST', body: '{}' }),
    },
  },
  // ── Model routes ──────────────────────────────────────────
  modelRoutes: {
    list: () => fetchJson<any[]>('/admin/routes'),
    get: (id: string) => fetchJson<any>(`/admin/routes/${id}`),
    create: (data: any) => fetchJson<any>('/admin/routes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => fetchJson<{ success: boolean }>(`/admin/routes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => fetchJson<{ success: boolean }>(`/admin/routes/${id}`, { method: 'DELETE' }),
    enable: (id: string) => fetchJson<{ success: boolean }>(`/admin/routes/${id}/enable`, { method: 'POST', body: '{}' }),
    disable: (id: string) => fetchJson<{ success: boolean }>(`/admin/routes/${id}/disable`, { method: 'POST', body: '{}' }),
    targets: {
      list: (routeId: string) => fetchJson<any[]>(`/admin/routes/${routeId}/targets`),
      add: (routeId: string, data: any) => fetchJson<any>(`/admin/routes/${routeId}/targets`, { method: 'POST', body: JSON.stringify(data) }),
      delete: (routeId: string, targetId: string) => fetchJson<{ success: boolean }>(`/admin/routes/${routeId}/targets/${targetId}`, { method: 'DELETE' }),
    },
  },
  // ── Model catalog ─────────────────────────────────────────
  modelCatalog: {
    list: (page = 1, perPage = 50, search?: string, providerId?: string) =>
      fetchJson<{ models: any[]; page: number; perPage: number; total: number }>(
        `/admin/model-catalog?page=${page}&perPage=${perPage}${search ? `&search=${encodeURIComponent(search)}` : ''}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ''}`
      ),
  },
  mixRoutes: {
    list: () => fetchJson<Array<{
      id: string;
      publicModelId: string;
      enabled: boolean;
      updatedAt: string;
      targets: Array<{
        providerModelId: string;
        providerName: string;
        providerType: string;
        providerSlug: string;
        upstreamModelId: string;
        publicModelId: string;
        priority: number;
        health: ModelHealth;
        benchmark: ModelBenchmark | null;
      }>;
    }>>('/admin/mix-routes'),
    create: (data: { publicModelId: string; providerModelIds: string[] }) =>
      fetchJson<{
        id: string;
        publicModelId: string;
        targets: string[];
        targetDetails: Array<{ providerModelId: string; publicModelId: string; health: ModelHealth; benchmark: ModelBenchmark | null }>;
        message: string;
      }>('/admin/mix-routes', { method: 'POST', body: JSON.stringify(data) }),
  },
  // ── Available models for route target selection ──────────
  availableModels: (providerId?: string) =>
    fetchJson<any[]>(`/admin/available-models${providerId ? `?providerId=${providerId}` : ''}`),
};

export type ModelBenchmark = {
  outcome: 'success' | 'rate_limited' | 'failed';
  latencyMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  testedAt: string;
};

export type ModelHealth = 'ready' | 'rate_limited' | 'untested' | 'stale' | 'failed' | 'inactive';
