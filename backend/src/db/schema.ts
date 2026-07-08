import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  maskedKey: text('masked_key').notNull(),
  priority: integer('priority').notNull(),
  status: text('status', { enum: ['active', 'cooldown', 'exhausted', 'disabled', 'invalid'] }).notNull().default('active'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastErrorCode: integer('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp' }),
  cooldownUntil: integer('cooldown_until', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const apiKeyEvents = sqliteTable('api_key_events', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  errorCode: integer('error_code'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  cooldown429Seconds: integer('cooldown_429_seconds').notNull().default(60),
  cooldown5xxSeconds: integer('cooldown_5xx_seconds').notNull().default(60),
  cooldownTimeoutSeconds: integer('cooldown_timeout_seconds').notNull().default(60),
  requestTimeoutSeconds: integer('request_timeout_seconds').notNull().default(120),
  ipAllowlist: text('ip_allowlist').notNull().default(''),
  publicModelIds: text('public_model_ids').notNull().default('mimo-v2.5,mimo-v2.5-pro'),
  gatewayKeyHash: text('gateway_key_hash').notNull().default(''),
  adminPasswordHash: text('admin_password_hash').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const gatewayCredentials = sqliteTable('gateway_credentials', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  keyHash: text('key_hash').notNull(),
  maskedKey: text('masked_key').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  maxRequests: integer('max_requests'),
  requestCount: integer('request_count').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const requestLogs = sqliteTable('request_logs', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  route: text('route').notNull(),
  model: text('model'),
  apiKeyId: text('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  statusCode: integer('status_code'),
  latencyMs: real('latency_ms').notNull(),
  streaming: integer('streaming', { mode: 'boolean' }).notNull().default(false),
  fallback: integer('fallback', { mode: 'boolean' }).notNull().default(false),
  clientIp: text('client_ip'),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  estimatedCost: real('estimated_cost').default(0),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
export type AdminSession = typeof adminSessions.$inferSelect;
export type NewAdminSession = typeof adminSessions.$inferInsert;
export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;
export type ApiKeyEvent = typeof apiKeyEvents.$inferSelect;
export type NewApiKeyEvent = typeof apiKeyEvents.$inferInsert;
export type GatewayCredential = typeof gatewayCredentials.$inferSelect;
export type NewGatewayCredential = typeof gatewayCredentials.$inferInsert;
