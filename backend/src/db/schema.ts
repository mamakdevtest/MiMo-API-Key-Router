import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ────────────────────────────────────────────────────────────
// Legacy MiMo tables (preserved for backward compatibility)
// ────────────────────────────────────────────────────────────

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
  // ── New multi-provider columns (added by migration 0003) ──
  ingressProtocol: text('ingress_protocol'),
  routeId: text('route_id'),
  publicModelId: text('public_model_id'),
  finalProviderId: text('final_provider_id'),
  finalCredentialId: text('final_credential_id'),
  upstreamModelId: text('upstream_model_id'),
  attemptCount: integer('attempt_count').default(1),
  failoverCount: integer('failover_count').default(0),
  cachedTokens: integer('cached_tokens').default(0),
  billingMode: text('billing_mode'),
  costSource: text('cost_source'),
});

// ────────────────────────────────────────────────────────────
// NEW: Multi-Provider Tables (added by migration 0003)
// ────────────────────────────────────────────────────────────

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['mimo', 'featherless'] }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  routingWeight: integer('routing_weight').notNull().default(1),
  healthStatus: text('health_status', {
    enum: ['healthy', 'degraded', 'capacity_limited', 'unavailable', 'disabled', 'unknown'],
  }).notNull().default('unknown'),
  healthMessage: text('health_message'),
  configJson: text('config_json'),
  billingMode: text('billing_mode', { enum: ['subscription', 'per_request', 'unknown'] }).notNull().default('unknown'),
  lastHealthCheckAt: integer('last_health_check_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const providerCredentials = sqliteTable('provider_credentials', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  maskedSecret: text('masked_secret').notNull(),
  priority: integer('priority').notNull().default(0),
  status: text('status', { enum: ['active', 'cooldown', 'exhausted', 'invalid', 'disabled'] }).notNull().default('active'),
  cooldownUntil: integer('cooldown_until', { mode: 'timestamp' }),
  failureCount: integer('failure_count').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp' }),
  lastErrorCode: integer('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const providerModels = sqliteTable('provider_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  upstreamModelId: text('upstream_model_id').notNull(),
  displayName: text('display_name'),
  modelClass: text('model_class'),
  status: text('status').notNull().default('active'),
  availabilityTier: text('availability_tier'),
  contextLength: integer('context_length'),
  effectiveContextLength: integer('effective_context_length'),
  maxCompletionTokens: integer('max_completion_tokens'),
  concurrencyCost: integer('concurrency_cost').notNull().default(1),
  isGated: integer('is_gated', { mode: 'boolean' }).notNull().default(false),
  availableOnCurrentPlan: integer('available_on_current_plan', { mode: 'boolean' }).notNull().default(true),
  supportsChat: integer('supports_chat', { mode: 'boolean' }).notNull().default(true),
  supportsTextCompletion: integer('supports_text_completion', { mode: 'boolean' }).notNull().default(false),
  supportsTools: integer('supports_tools', { mode: 'boolean' }).notNull().default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),
  supportsEmbeddings: integer('supports_embeddings', { mode: 'boolean' }).notNull().default(false),
  inputModalitiesJson: text('input_modalities_json'),
  outputModalitiesJson: text('output_modalities_json'),
  tasksJson: text('tasks_json'),
  featuresJson: text('features_json'),
  pricingPrompt: text('pricing_prompt'),
  pricingCompletion: text('pricing_completion'),
  pricingImage: text('pricing_image'),
  pricingRequest: text('pricing_request'),
  metadataJson: text('metadata_json'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const modelRoutes = sqliteTable('model_routes', {
  id: text('id').primaryKey(),
  publicModelId: text('public_model_id').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  routeKind: text('route_kind', { enum: ['chat', 'text_completion', 'embedding'] }).notNull().default('chat'),
  strategy: text('strategy', { enum: ['priority_failover', 'weighted_round_robin', 'least_concurrency', 'lowest_cost'] }).notNull().default('priority_failover'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  allowedProtocolsJson: text('allowed_protocols_json'),
  requiredCapabilitiesJson: text('required_capabilities_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const modelRouteTargets = sqliteTable('model_route_targets', {
  id: text('id').primaryKey(),
  routeId: text('route_id').notNull().references(() => modelRoutes.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  providerModelId: text('provider_model_id').notNull().references(() => providerModels.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  weight: integer('weight').notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  timeoutOverrideMs: integer('timeout_override_ms'),
  maxAttemptsOverride: integer('max_attempts_override'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const requestAttempts = sqliteTable('request_attempts', {
  id: text('id').primaryKey(),
  requestLogId: text('request_log_id').notNull().references(() => requestLogs.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  routeId: text('route_id'),
  routeTargetId: text('route_target_id'),
  providerId: text('provider_id'),
  credentialId: text('credential_id'),
  upstreamModelId: text('upstream_model_id'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  latencyMs: real('latency_ms'),
  httpStatus: integer('http_status'),
  result: text('result'),
  errorScope: text('error_scope'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
  responseStarted: integer('response_started', { mode: 'boolean' }).notNull().default(false),
});

// ────────────────────────────────────────────────────────────
// Type exports
// ────────────────────────────────────────────────────────────

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
export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type NewProviderCredential = typeof providerCredentials.$inferInsert;
export type ProviderModel = typeof providerModels.$inferSelect;
export type NewProviderModel = typeof providerModels.$inferInsert;
export type ModelRoute = typeof modelRoutes.$inferSelect;
export type NewModelRoute = typeof modelRoutes.$inferInsert;
export type ModelRouteTarget = typeof modelRouteTargets.$inferSelect;
export type NewModelRouteTarget = typeof modelRouteTargets.$inferInsert;
export type RequestAttempt = typeof requestAttempts.$inferSelect;
export type NewRequestAttempt = typeof requestAttempts.$inferInsert;
