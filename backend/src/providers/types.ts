/**
 * Provider domain types for the Multi-Provider AI Gateway.
 *
 * Provider type = the upstream service family (mimo, featherless, …)
 * Provider instance = a configured account within a provider type.
 * Provider credential = a single API key belonging to a provider instance.
 * Provider adapter = the logic that translates canonical ↔ upstream for a provider type.
 */

// ────────────────────────────────────────────────────────────
// Provider types (extensible via union)
// ────────────────────────────────────────────────────────────

export type ProviderType = 'mimo' | 'featherless' | 'orcarouter' | 'openai_compatible';

export type BillingMode = 'subscription' | 'per_request' | 'unknown';

export type CredentialStatus = 'active' | 'cooldown' | 'exhausted' | 'invalid' | 'disabled';

export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'capacity_limited'
  | 'unavailable'
  | 'disabled'
  | 'unknown';

export type RouteKind = 'chat' | 'text_completion' | 'embedding';

export type IngressProtocol = 'openai' | 'anthropic';

export type RouteStrategy = 'priority_failover' | 'weighted_round_robin' | 'least_concurrency' | 'lowest_cost';

export type CostSource =
  | 'provider_dynamic_pricing'
  | 'manual_override'
  | 'static_catalog'
  | 'subscription'
  | 'unknown';

export type ErrorScope = 'request' | 'credential' | 'model' | 'provider';

export type ErrorAction =
  | 'fail_client'
  | 'retry_same_target'
  | 'next_credential'
  | 'next_target';

// ────────────────────────────────────────────────────────────
// Provider configuration
// ────────────────────────────────────────────────────────────

export interface ProviderConfig {
  baseUrl: string;
  authHeader?: string;
  authPrefix?: string;
  /** Provider-specific headers (e.g. HTTP-Referer, X-Title for Featherless) */
  extraHeaders?: Record<string, string>;
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────
// Provider instance (DB representation)
// ────────────────────────────────────────────────────────────

export interface ProviderInstance {
  id: string;
  type: ProviderType;
  name: string;
  slug: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  routingWeight: number;
  healthStatus: ProviderHealthStatus;
  healthMessage: string | null;
  configJson: string | null;
  billingMode: BillingMode;
  lastHealthCheckAt: Date | null;
  // ── Extended provider config (migration 0004) ──
  documentationUrl: string | null;
  authHeader: string;
  authPrefix: string;
  modelsEndpoint: string;
  chatCompletionsEndpoint: string;
  embeddingsEndpoint: string | null;
  customHeadersJson: string | null;
  timeoutMs: number | null;
  healthCheckEndpoint: string | null;
  capabilitiesJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ────────────────────────────────────────────────────────────
// Provider credential (DB representation)
// ────────────────────────────────────────────────────────────

export interface ProviderCredential {
  id: string;
  providerId: string;
  name: string;
  encryptedSecret: string;
  maskedSecret: string;
  priority: number;
  status: CredentialStatus;
  cooldownUntil: Date | null;
  failureCount: number;
  successCount: number;
  lastUsedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: number | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ────────────────────────────────────────────────────────────
// Provider model (DB representation)
// ────────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  displayName: string | null;
  modelClass: string | null;
  status: string;
  availabilityTier: string | null;
  contextLength: number | null;
  effectiveContextLength: number | null;
  maxCompletionTokens: number | null;
  concurrencyCost: number;
  isGated: boolean;
  availableOnCurrentPlan: boolean;
  supportsChat: boolean;
  supportsTextCompletion: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
  inputModalitiesJson: string | null;
  outputModalitiesJson: string | null;
  tasksJson: string | null;
  featuresJson: string | null;
  pricingPrompt: string | null;
  pricingCompletion: string | null;
  pricingImage: string | null;
  pricingRequest: string | null;
  metadataJson: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ────────────────────────────────────────────────────────────
// Model route (gateway → provider mapping)
// ────────────────────────────────────────────────────────────

export interface ModelRoute {
  id: string;
  publicModelId: string;
  displayName: string | null;
  description: string | null;
  routeKind: RouteKind;
  strategy: RouteStrategy;
  enabled: boolean;
  isPublic: boolean;
  allowedProtocolsJson: string | null;
  requiredCapabilitiesJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelRouteTarget {
  id: string;
  routeId: string;
  providerId: string;
  providerModelId: string;
  priority: number;
  weight: number;
  enabled: boolean;
  timeoutOverrideMs: number | null;
  maxAttemptsOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ────────────────────────────────────────────────────────────
// Request attempt (per-upstream-try logging)
// ────────────────────────────────────────────────────────────

export interface RequestAttempt {
  id: string;
  requestLogId: string;
  attemptNumber: number;
  routeId: string | null;
  routeTargetId: string | null;
  providerId: string | null;
  credentialId: string | null;
  upstreamModelId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  latencyMs: number | null;
  httpStatus: number | null;
  result: string | null;
  errorScope: ErrorScope | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  responseStarted: boolean;
}

// ────────────────────────────────────────────────────────────
// Provider adapter capability descriptor
// ────────────────────────────────────────────────────────────

export interface ProviderCapabilities {
  supportsChat: boolean;
  supportsTextCompletion: boolean;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
}

// ────────────────────────────────────────────────────────────
// Adapter context types
// ────────────────────────────────────────────────────────────

export interface DecryptedProviderCredential {
  id: string;
  providerId: string;
  name: string;
  secret: string;
  maskedSecret: string;
  priority: number;
  status: CredentialStatus;
}

export interface ProviderRequestContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  /** The canonical request to translate */
  canonicalRequest: CanonicalRequest;
  ingressProtocol: IngressProtocol;
  routeId: string | null;
  routeTargetId: string | null;
}

export interface ProviderResponseContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  upstreamResponse: Response;
  upstreamBody: unknown;
  requestContext: ProviderRequestContext;
}

export interface StreamChunkContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  chunk: string;
  isFirstChunk: boolean;
  allChunks: string[];
  requestContext: ProviderRequestContext;
}

export interface ProviderErrorContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  error?: Error;
  httpStatus?: number;
  responseBody?: unknown;
  requestContext: ProviderRequestContext;
}

export interface UsageExtractionContext {
  provider: ProviderInstance;
  responseBody: unknown;
  isStreaming: boolean;
  streamChunks?: string[];
  requestContext: ProviderRequestContext;
}

export interface ProviderModelListContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  page: number;
  perPage: number;
  filters?: Record<string, string | string[] | boolean | number>;
}

export interface ProviderModelDetailContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
  modelId: string;
}

export interface ProviderPlanContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
}

export interface ProviderConcurrencyContext {
  provider: ProviderInstance;
  credential: DecryptedProviderCredential;
}

export interface CredentialTestResult {
  success: boolean;
  message: string;
  plan?: ProviderPlanSnapshot | null;
}

export interface ProviderPlanSnapshot {
  planId: string | null;
  planName: string | null;
  maxContextLength: number | null;
  maxModelSize: number | null;
  concurrencyLimit: number | null;
  updatedAt: string | null;
}

export interface ProviderConcurrencySnapshot {
  limit: number | null;
  usedCost: number;
  requestCount: number;
  requests: Array<{
    id: string;
    cost: number;
    model: string;
    startedAt: number;
    durationMs: number;
  }>;
}

export interface ProviderModelPage {
  models: Array<{
    upstreamModelId: string;
    displayName: string | null;
    modelClass: string | null;
    status: string;
    contextLength: number | null;
    maxCompletionTokens: number | null;
    isGated: boolean;
    availableOnCurrentPlan: boolean;
    [key: string]: unknown;
  }>;
  totalCount: number | null;
  page: number;
  perPage: number;
}

export interface ProviderModelDetail {
  upstreamModelId: string;
  displayName: string | null;
  modelClass: string | null;
  status: string;
  availabilityTier: string | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  concurrencyCost: number;
  isGated: boolean;
  availableOnCurrentPlan: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsChat: boolean;
  supportsTextCompletion: boolean;
  supportsEmbeddings: boolean;
  inputModalities: string[];
  outputModalities: string[];
  tasks: string[];
  pricing: {
    prompt: string | null;
    completion: string | null;
    image: string | null;
    request: string | null;
  };
  metadata: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ────────────────────────────────────────────────────────────
// Canonical request / response models
// ────────────────────────────────────────────────────────────

export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | CanonicalContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: CanonicalToolCall[];
}

export type CanonicalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } };

export interface CanonicalToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CanonicalToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type CanonicalToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } };

export type CanonicalResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; jsonSchema: Record<string, unknown> };

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
  tools?: CanonicalToolDefinition[];
  toolChoice?: CanonicalToolChoice;
  /** Structured output (json_object / json_schema) */
  responseFormat?: CanonicalResponseFormat;
  /** Provider-specific extras (e.g. chat_template_kwargs) */
  extra?: Record<string, unknown>;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls: CanonicalToolCall[] | null;
  finishReason: string | null;
  usage: NormalizedUsage | null;
  raw?: unknown;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  imageUnits?: number;
}

export interface CanonicalStreamEvent {
  type: 'content_delta' | 'tool_call_delta' | 'usage' | 'done';
  content?: string;
  toolCallIndex?: number;
  toolCallDelta?: Partial<CanonicalToolCall>;
  usage?: NormalizedUsage;
}

// ────────────────────────────────────────────────────────────
// Error classification
// ────────────────────────────────────────────────────────────

export interface ClassifiedProviderError {
  category: string;
  scope: ErrorScope;
  retryable: boolean;
  action: ErrorAction;
  cooldownMs?: number;
  publicMessage: string;
  internalMessage?: string;
}

// ────────────────────────────────────────────────────────────
// Upstream request (built by adapter)
// ────────────────────────────────────────────────────────────

export interface UpstreamRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

// ────────────────────────────────────────────────────────────
// Provider adapter interface
// ────────────────────────────────────────────────────────────

export interface ProviderAdapter {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapabilities;

  validateConfig(config: ProviderConfig): Promise<ValidationResult>;

  testCredential(
    provider: ProviderInstance,
    credential: DecryptedProviderCredential,
  ): Promise<CredentialTestResult>;

  buildUpstreamRequest(
    context: ProviderRequestContext,
  ): Promise<UpstreamRequest>;

  parseNonStreamingResponse(
    context: ProviderResponseContext,
  ): Promise<CanonicalResponse>;

  transformStreamChunk?(
    context: StreamChunkContext,
  ): Promise<CanonicalStreamEvent[]>;

  classifyError(
    context: ProviderErrorContext,
  ): Promise<ClassifiedProviderError>;

  extractUsage(
    context: UsageExtractionContext,
  ): Promise<NormalizedUsage | null>;

  listModels?(
    context: ProviderModelListContext,
  ): Promise<ProviderModelPage>;

  getModel?(
    context: ProviderModelDetailContext,
  ): Promise<ProviderModelDetail>;

  getPlan?(
    context: ProviderPlanContext,
  ): Promise<ProviderPlanSnapshot>;

  getConcurrency?(
    context: ProviderConcurrencyContext,
  ): Promise<ProviderConcurrencySnapshot>;
}
