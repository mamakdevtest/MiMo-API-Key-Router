# AI Provider Router

AI Provider Router is a self-hosted, multi-provider AI gateway. Clients use one router key while provider credentials remain encrypted in the router. It accepts OpenAI- and Anthropic-compatible chat requests and routes them to a configured provider model.

Supported provider adapters: Xiaomi MiMo, Featherless, OrcaRouter, and custom OpenAI-compatible services.

## Highlights

- One client-facing gateway key; provider credentials are encrypted at rest.
- Per-provider credential pools, priorities, cooldowns, and automatic failover.
- Provider validation, credential testing, model synchronization, and health information from the dashboard.
- Per-provider model benchmarking with a durable last result, health-aware catalog ordering, and no routing-side filtering.
- OpenAI-compatible chat and Anthropic-compatible messages, including streaming.
- SQLite persistence, Docker deployment, and Coolify-ready reverse-proxy settings.

## Quick start

```bash
npm install
cp .env.example .env
# Set INITIAL_ADMIN_PASSWORD, GATEWAY_KEY, APP_ENCRYPTION_KEY, and SESSION_SECRET.
npm run dev
```

The backend is available at `http://localhost:4000`; Vite serves the local dashboard at `http://localhost:4173`. Local development writes SQLite data to `./data/mimo-router.sqlite`; Docker Compose overrides this with its persistent `/data` volume.

### Claude Code knowledge graph

This repository is configured for Graphify and Claude Code. `CLAUDE.md` directs Claude to query the local graph first, while `.claude/settings.json` includes the Graphify `PreToolUse` hook for search and file-read tools. The local `graphify-out/` directory and `.graphify-venv/` are intentionally ignored because graph output is generated and must not index credentials or local runtime data.

To refresh the graph after source changes, run:

```bash
.graphify-venv/bin/graphify update .
```

With npm 12 or later, native dependency scripts may require approval after installation:

```bash
npm install-scripts approve --all
npm rebuild
```

This builds the native `better-sqlite3` and `argon2` bindings for the active Node version. If only these packages are blocked, approve them explicitly instead:

```bash
npm install-scripts approve better-sqlite3 argon2 esbuild
```

## First configuration

1. Open the dashboard and log in with `INITIAL_ADMIN_PASSWORD`.
2. Create a provider. Choose its adapter type, a unique lowercase slug, and its upstream base URL.
3. Add one or more credentials to that provider, then test them.
4. Synchronize models. Public model IDs use `provider-slug/upstream-model-id`.
5. Use `GATEWAY_KEY` in your client requests.

For example, a provider with slug `orca-main` and upstream model `orcarouter/auto` is addressed as `orca-main/orcarouter/auto`.

`GATEWAY_KEY` is stored as a hash when a database is initialized. Setting a new value in `.env` does not replace the gateway key of an existing database; rotate that key from the dashboard instead.

## Model benchmark

Open **Benchmark** in the dashboard, select a provider, and run the check after synchronizing its models. The router sends a selected batch of chat models `Reply only: OK` with `max_tokens: 1` and records only the final outcome for each provider model: success, Vercel free-tier rate limit, or failure. The default batch is 20 models, which prevents large catalog providers from creating excessively long diagnostic requests. Enable **Test every eligible model sequentially** to run the entire chat catalog one model at a time as a background job; the dashboard shows live progress and partial results. If a full-catalog test detects insufficient balance (including HTTP `402`), it marks that credential exhausted and retries the same model with the next active credential. The Vercel message `Free tier requests on this model are rate-limited.` is counted as **available**, displays **rate limited** instead of a latency, and never exhausts the key. The **Stop test** button ends the job after its active request finishes; a model that has not finished is not recorded. Benchmark calls can still consume a small amount of upstream quota.

The **Model Catalog**, mix-router search, saved mix targets, provider cards, and Dashboard use the same health state: fresh ready, fresh rate limited, untested, stale (last result is at least 24 hours old), fresh failed, or inactive. Catalog results are ordered in that order, then by latency, provider priority, and model name. Health is dashboard metadata only: it never hides `/v1/models` entries or prevents direct routing/failover.

## Vercel model mix router

In **Model Catalog**, use the separate **Mix router builder** to search for and add any number of active chat models, then create an alias such as `vercel.mix.router`. The selection order is the failover order, and there is no limit on how many mix-router aliases you can create. **Saved mix routers** lists existing aliases and loads one back into the builder for editing. Clients then call the alias as their `model`. When Vercel returns its free-tier per-model rate-limit message, the router tries every active Vercel key in order, repeats that key pass once, and then falls through to the next model in the alias. A rate-limited key is not disabled, cooled down, or marked exhausted. Insufficient-balance keys are still automatically marked exhausted.

## Client API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Health status; does not require a key |
| `GET` | `/v1/models` | Lists public model IDs |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat |
| `POST` | `/v1/messages` | Anthropic-compatible messages |

All `/v1/*` endpoints require `Authorization: Bearer <GATEWAY_KEY>`.

```bash
curl http://localhost:4000/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_GATEWAY_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"provider-slug/upstream-model-id","messages":[{"role":"user","content":"Hello"}]}'
```

`/v1/completions`, `/v1/embeddings`, and `/v1/tokenize` currently return `501 Not Implemented`.

## Environment

Copy [.env.example](./.env.example) and set every required secret before production use.

| Variable | Purpose |
|---|---|
| `INITIAL_ADMIN_PASSWORD` | Required only to initialise a new database; remove after initial setup |
| `GATEWAY_KEY` | Stable router key clients use; set it before first boot |
| `APP_ENCRYPTION_KEY` | 32+ character key that encrypts provider credentials; never change it without a credential migration |
| `SESSION_SECRET` | 32+ character admin-session signing secret; keep it stable |
| `DATABASE_URL` | SQLite location; use `file:./data/mimo-router.sqlite` locally and `file:/data/mimo-router.sqlite` in containers |
| `MAX_UPSTREAM_ATTEMPTS` | Upper bound for one gateway request; default `120`, sized for Vercel mix-route key retries |
| `HOST`, `PORT`, `APP_NAME`, `LOG_LEVEL` | Server runtime settings |
| `TRUST_PROXY`, `COOKIE_SECURE` | Enable for HTTPS behind a trusted reverse proxy |
| `SESSION_MAX_AGE_SECONDS` | Admin-session lifetime, default `86400` |
| `ALLOW_PRIVATE_PROVIDER_URLS` | Keep `false` unless private upstream URLs are intentionally required |

The legacy `MIMO_*` variables are no longer part of deployment configuration. Provider URLs and authentication are managed per provider in the dashboard.

## Docker

```bash
cp .env.example .env
# Fill in the required secrets.
docker compose up --build -d
```

Persist `/data`; it contains the SQLite database. See [COOLIFY.md](./COOLIFY.md) for hosted deployment and [docs](./docs/README.md) for operational guides.

## License

MIT
