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
  logout: () => fetchJson<{ success: boolean }>('/admin/logout', { method: 'POST' }),
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
    update: (id: string, data: { label?: string; priority?: number; note?: string }) =>
      fetchJson<{ success: boolean }>(`/admin/keys/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}`, { method: 'DELETE' }),
    enable: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/enable`, { method: 'POST' }),
    disable: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/disable`, { method: 'POST' }),
    reset: (id: string) => fetchJson<{ success: boolean }>(`/admin/keys/${id}/reset`, { method: 'POST' }),
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
  rotateGatewayKey: () => fetchJson<{ key: string }>('/admin/rotate-gateway-key', { method: 'POST' }),
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
      }>>(`/admin/logs?limit=${limit}&offset=${offset}`),
  },
};
