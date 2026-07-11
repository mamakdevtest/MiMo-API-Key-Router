# Multi-Provider AI Gateway Architecture

## Overview

The MiMo API Key Router has been re-architected into a **Multi-Provider AI Gateway** that supports multiple upstream AI providers through a unified, provider-agnostic interface.

## Architecture Layers

```
Client (Claude Code, Open WebUI, etc.)
  ↓
Ingress Protocol Adapter (OpenAI / Anthropic)
  ↓
Canonical Internal Request
  ↓
Model Route Resolver
  ↓
Provider Target Selection (priority_failover)
  ↓
Credential Selection (per-provider key pool)
  ↓
Provider Adapter (MiMo / Featherless / ...)
  ↓
Upstream Provider (api.xiaomimimo.com / api.featherless.ai / ...)
  ↓
Canonical Internal Response
  ↓
Client Protocol Response
```

## Key Concepts

### Ingress Protocol vs Upstream Provider

- **Ingress protocol**: How the client talks to the gateway (OpenAI format or Anthropic format)
- **Upstream provider**: Where the request actually goes (MiMo, Featherless, etc.)

A provider that only supports OpenAI API can still serve Anthropic clients through the gateway's protocol translation layer.

### Provider Type vs Provider Instance

- **Provider type**: The upstream service family (e.g., `featherless`)
- **Provider instance**: A configured account within a provider type (e.g., "Featherless Main Account")

Multiple instances of the same provider type can coexist, each with their own credentials, health status, and configuration.

### Model Routes

A **model route** maps a public model ID (e.g., `coding-pro`) to one or more provider targets. Routes support:

- `priority_failover`: Try targets in priority order, failover on error
- `weighted_round_robin`: Round-robin with weights (future)
- `least_concurrency`: Pick the least loaded target (future)
- `lowest_cost`: Pick the cheapest target (future)

## Backend Structure

```
backend/src/
├── providers/
│   ├── types.ts              # All provider domain types
│   ├── registry.ts           # Adapter registry
│   ├── provider-service.ts   # Provider/credential CRUD & selection
│   └── adapters/
│       ├── mimo.adapter.ts   # MiMo provider adapter
│       └── featherless.adapter.ts  # Featherless provider adapter
├── routing/
│   ├── route-resolver.ts     # Model → provider target resolution
│   ├── request-orchestrator.ts  # Multi-provider proxy core
│   └── error-classifier.ts   # HTTP error → action mapping
├── usage/
│   └── usage-normalizer.ts   # Token/cost extraction & calculation
├── services/
│   ├── model-sync-service.ts # Model catalog synchronization
│   ├── provider-health-service.ts  # Periodic health checks
│   └── concurrency-monitor.ts  # Featherless concurrency tracking
└── routes/
    ├── gateway.ts            # Public API endpoints
    ├── admin.ts              # Legacy admin routes
    ├── admin-providers.ts    # Provider CRUD admin routes
    └── admin-routes.ts       # Model route CRUD admin routes
```

## Database Schema

### New Tables

| Table | Purpose |
|-------|---------|
| `providers` | Provider instances (type, name, slug, base_url, health, billing) |
| `provider_credentials` | Per-provider API keys (encrypted, masked, status, cooldown) |
| `provider_models` | Synced model catalog per provider |
| `model_routes` | Public model ID → target mapping |
| `model_route_targets` | Individual targets within a route |
| `request_attempts` | Per-upstream-attempt logging |

### Extended Tables

`request_logs` gained columns for: `ingress_protocol`, `route_id`, `public_model_id`, `final_provider_id`, `final_credential_id`, `upstream_model_id`, `attempt_count`, `failover_count`, `cached_tokens`, `billing_mode`, `cost_source`.

## Provider Adapter Interface

Every provider implements `ProviderAdapter`:

- `testCredential()` — Verify API key works
- `buildUpstreamRequest()` — Translate canonical → upstream request
- `parseNonStreamingResponse()` — Translate upstream → canonical response
- `classifyError()` — Map HTTP errors to actions
- `extractUsage()` — Extract token usage from response
- `listModels()` — Fetch model catalog (optional)
- `getModel()` — Fetch model details (optional)
- `getPlan()` — Fetch plan info (optional)
- `getConcurrency()` — Fetch concurrency state (optional)

## Supported Providers

### Xiaomi MiMo

- OpenAI-compatible upstream (`/v1/chat/completions`)
- Anthropic-compatible upstream (`/v1/messages`)
- SSE streaming pass-through
- Error codes: 402 (exhausted), 401 (invalid), 403 (disabled), 429 (cooldown)
- Low-credit body detection

### Featherless.ai

- OpenAI-compatible upstream (`/v1/chat/completions`, `/v1/completions`)
- Embeddings (`/v1/embeddings`)
- Tokenize (`/v1/tokenize`)
- Model catalog with server-side pagination (`/v1/models`)
- Plan info (`/v1/plan`)
- Concurrency monitoring (`/account/concurrency/stream`)
- Tool calling support (Qwen3, Kimi K2 families)
- Vision support (Gemma 3, etc.)
- Reasoning via `chat_template_kwargs` (`enable_thinking`, `thinking`, etc.)
- Dynamic pricing per model
- Billing modes: subscription, per_request

## Security

- API keys encrypted with AES-256-GCM (PBKDF2 key derivation)
- Admin passwords hashed with Argon2id
- Gateway keys hashed with Argon2id
- CSRF protection on admin endpoints
- IP allowlist with CIDR support
- Rate limiting (200/min global, 5/5min for login)
- Helmet CSP headers
- Secret values never exposed in API responses or logs
- Non-root Docker user

## Migration

Migration `0003` creates the new tables and migrates existing data:

1. Creates a default `mimo` provider instance
2. Copies existing `api_keys` to `provider_credentials`
3. Links existing `request_logs` to the mimo provider
4. All non-destructive — old tables preserved

## Frontend

Updated sidebar navigation:

- **Overview** — Multi-provider dashboard with global stats
- **Providers** — Provider instance management
- **Model Catalog** — Unified model browser with server-side pagination
- **Routes** — Model route editor with target management
- **Gateway Keys** — Legacy key management (preserved)
- **Requests** — Provider-aware request logs
- **Settings** — Gateway configuration
- **Docs** — Documentation
