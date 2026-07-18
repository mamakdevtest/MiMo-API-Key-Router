# AI Provider Router

AI Provider Router is a TypeScript monorepo for running a private, self-hosted AI gateway. The frontend is a React/Vite admin dashboard and the backend is a Fastify service backed by SQLite and Drizzle ORM.

The router supports MiMo, Featherless, OrcaRouter, and generic OpenAI-compatible upstreams. It keeps each provider's credentials encrypted, gives clients one router key, and addresses models using `provider-slug/upstream-model-id`.

## Main capabilities

- OpenAI-compatible chat and Anthropic-compatible message ingress
- Per-provider credential pools, priority selection, cooldowns, and failover
- Provider testing, model synchronization, health information, and custom provider settings
- Admin sessions, CSRF protection, IP allowlists, rate limits, and encrypted credential storage
- Docker/Coolify deployment with a persistent SQLite volume

## Workspace

```text
backend/   Fastify API, routing, adapters, SQLite migrations
frontend/  React management dashboard
shared/    Shared TypeScript types and model data
docs/      Setup and operations documentation
```

See [README.md](./README.md) for installation and [docs/README.md](./docs/README.md) for operations.
