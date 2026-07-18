# AI Provider Router

AI Provider Router is a self-hosted, multi-provider AI gateway. Clients use one router key while provider credentials remain encrypted in the router. It accepts OpenAI- and Anthropic-compatible chat requests and routes them to a configured provider model.

Supported provider adapters: Xiaomi MiMo, Featherless, OrcaRouter, and custom OpenAI-compatible services.

## Highlights

- One client-facing gateway key; provider credentials are encrypted at rest.
- Per-provider credential pools, priorities, cooldowns, and automatic failover.
- Provider validation, credential testing, model synchronization, and health information from the dashboard.
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
