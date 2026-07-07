export type ApiKeyStatus = 'active' | 'cooldown' | 'exhausted' | 'disabled' | 'invalid';

export interface ApiKey {
  id: string;
  label: string;
  encryptedKey: string;
  maskedKey: string;
  priority: number;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  lastErrorCode: number | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyEvent {
  id: string;
  apiKeyId: string;
  eventType: string;
  errorCode: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Settings {
  id: string;
  cooldown429Seconds: number;
  cooldown5xxSeconds: number;
  cooldownTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  ipAllowlist: string;
  publicModelIds: string;
  gatewayKeyHash: string;
  adminPasswordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSession {
  id: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface RequestLog {
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
}

export interface DashboardStats {
  gatewayStatus: 'healthy' | 'degraded' | 'down';
  totalKeys: number;
  activeKeys: number;
  cooldownKeys: number;
  exhaustedKeys: number;
  requestsLast24h: number;
  successRate: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  public: boolean;
}

export const ALL_MODELS: ModelInfo[] = [
  { id: 'mimo-v2.5', name: 'MiMo v2.5', description: 'General chat model', public: true },
  { id: 'mimo-v2.5-pro', name: 'MiMo v2.5 Pro', description: 'Advanced chat model', public: true },
  { id: 'mimo-v2.5-asr', name: 'MiMo v2.5 ASR', description: 'Speech recognition', public: false },
  { id: 'mimo-v2.5-tts', name: 'MiMo v2.5 TTS', description: 'Text-to-speech', public: false },
  { id: 'mimo-v2.5-tts-voiceclone', name: 'MiMo v2.5 TTS Voice Clone', description: 'Voice cloning', public: false },
  { id: 'mimo-v2.5-tts-voicedesign', name: 'MiMo v2.5 TTS Voice Design', description: 'Voice design', public: false },
];

export interface CreateApiKeyRequest {
  label: string;
  key: string;
  priority: number;
  note?: string;
}

export interface UpdateApiKeyRequest {
  label?: string;
  priority?: number;
  note?: string;
}

export interface ApiKeyResponse {
  id: string;
  label: string;
  maskedKey: string;
  priority: number;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  lastErrorCode: number | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsResponse {
  cooldown429Seconds: number;
  cooldown5xxSeconds: number;
  cooldownTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  ipAllowlist: string;
  publicModelIds: string[];
}

export interface UpdateSettingsRequest {
  cooldown429Seconds?: number;
  cooldown5xxSeconds?: number;
  cooldownTimeoutSeconds?: number;
  requestTimeoutSeconds?: number;
  ipAllowlist?: string;
  publicModelIds?: string[];
}

export interface RotateGatewayKeyResponse {
  key: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  success: boolean;
}

export interface ErrorResponse {
  error: string;
  message?: string;
}
