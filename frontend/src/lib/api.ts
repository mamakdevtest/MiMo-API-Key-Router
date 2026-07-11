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

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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
    list: () => fetchJson<Array<{ id: string; name: string; description: string; public: boolean }>>('/admin/models'),
  },
  rotateGatewayKey: () => fetchJson<{ key: string }>('/admin/rotate-gateway-key', { method: 'POST', body: '{}' }),
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
  tempKeys: {
    list: () =>
      fetchJson<Array<{
        id: string;
        label: string;
        maskedKey: string;
        expiresAt: string | null;
        isExpired: boolean;
        maxRequests: number | null;
        requestCount: number;
        isActive: boolean;
        createdAt: string;
      }>>('/admin/temp-keys'),
    create: (data: { label: string; expiresInMinutes?: number; maxRequests?: number }) =>
      fetchJson<{
        id: string;
        key: string;
        label: string;
        maskedKey: string;
        expiresAt: string | null;
        maxRequests: number | null;
        message: string;
      }>('/admin/temp-keys', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => fetchJson<{ success: boolean }>(`/admin/temp-keys/${id}`, { method: 'DELETE' }),
    revoke: (id: string) => fetchJson<{ success: boolean }>(`/admin/temp-keys/${id}/revoke`, { method: 'POST', body: '{}' }),
    reactivate: (id: string) => fetchJson<{ success: boolean }>(`/admin/temp-keys/${id}/reactivate`, { method: 'POST', body: '{}' }),
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
    syncModels: (id: string) => fetchJson<any>(`/admin/providers/${id}/sync-models`, { method: 'POST', body: '{}' }),
    getPlan: (id: string) => fetchJson<any>(`/admin/providers/${id}/plan`),
    getConcurrency: (id: string) => fetchJson<any>(`/admin/providers/${id}/concurrency`),
    getModels: (id: string) => fetchJson<any[]>(`/admin/providers/${id}/models`),
    credentials: {
      list: (providerId: string) => fetchJson<any[]>(`/admin/providers/${providerId}/credentials`),
      create: (providerId: string, data: any) => fetchJson<any>(`/admin/providers/${providerId}/credentials`, { method: 'POST', body: JSON.stringify(data) }),
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
    list: (page = 1, perPage = 50, search?: string) =>
      fetchJson<{ models: any[]; page: number; perPage: number; total: number }>(
        `/admin/model-catalog?page=${page}&perPage=${perPage}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      ),
  },
  // ── Available models for route target selection ──────────
  availableModels: (providerId?: string) =>
    fetchJson<any[]>(`/admin/available-models${providerId ? `?providerId=${providerId}` : ''}`),
};
