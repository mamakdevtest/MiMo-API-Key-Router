# MiMo API Key Router

A production-ready, single-container API gateway that proxies OpenAI/Anthropic-compatible client requests to Xiaomi MiMo using a pool of pay-as-you-go API keys.

## Features

- Single gateway API key for all clients
- Encrypted storage of real MiMo keys (AES-256-GCM)
- Ordered key failover with cooldown/exhausted/invalid/disabled states
- Anthropic-compatible `/v1/messages` and `/v1/models`
- OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/health`
- Admin dashboard with dark, minimal UI
- Optional IP allowlist with safe reverse-proxy handling
- SQLite database with WAL mode
- Single Dockerfile + docker-compose for easy deployment

## Tech Stack

- Backend: TypeScript + Fastify
- Frontend: React + Vite + Tailwind CSS + shadcn/ui
- Database: SQLite + Drizzle ORM
- Crypto: AES-256-GCM, Argon2id

## 1. Local Development

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env and set APP_ENCRYPTION_KEY and INITIAL_ADMIN_PASSWORD

# Run migrations
npm run db:migrate

# Start backend and frontend
npm run dev
```

The backend runs on `http://localhost:3000` and the frontend dev server on `http://localhost:5173`.

## 2. Docker

```bash
# Build and run
cp .env.example .env
# Edit .env

docker compose up --build -d
```

The container exposes port `3000` and persists data in `/data`.

## 3. Coolify Setup

See [COOLIFY.md](./COOLIFY.md) for detailed Coolify deployment instructions.

## 4. Domain Binding

Point your domain (e.g. `api.ai.emirhanmamak.com`) to your Coolify server. Coolify will handle HTTPS termination and reverse proxy to the container on port `3000`.

## 5. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ENCRYPTION_KEY` | Yes | 32+ char key for encrypting MiMo API keys |
| `INITIAL_ADMIN_PASSWORD` | First boot | Admin dashboard password |
| `SESSION_SECRET` | Production | Secret for signing session cookies |
| `DATABASE_URL` | No | SQLite path, default `file:/data/mimo-router.sqlite` |
| `TRUST_PROXY` | No | Trust `X-Forwarded-For` from reverse proxy |
| `COOKIE_SECURE` | No | Use secure cookies (set `true` with HTTPS) |
| `MIMO_OPENAI_BASE_URL` | No | Default `https://api.xiaomimimo.com/v1` |
| `MIMO_ANTHROPIC_BASE_URL` | No | Default `https://api.xiaomimimo.com/anthropic` |

## 6. Gateway Key Creation

On first boot, the gateway API key is printed in the container logs:

```text
========================================
Gateway API Key (save this securely):
mimo_...
========================================
```

Copy it immediately. It is stored only as an Argon2id hash in the database and is never shown again in full.

You can rotate the gateway key from the admin dashboard. The old key becomes invalid immediately.

## 7. Claude Code Configuration

Set these environment variables for Claude Code:

```bash
ANTHROPIC_BASE_URL=https://api.ai.emirhanmamak.com
ANTHROPIC_AUTH_TOKEN=<GATEWAY_API_KEY>
ANTHROPIC_MODEL=mimo-v2.5-pro
ANTHROPIC_DEFAULT_SONNET_MODEL=mimo-v2.5-pro
ANTHROPIC_DEFAULT_OPUS_MODEL=mimo-v2.5-pro
ANTHROPIC_DEFAULT_HAIKU_MODEL=mimo-v2.5
```

## 8. Open WebUI Configuration

In Open WebUI, add an OpenAI API connection:

```text
OpenAI Base URL: https://api.ai.emirhanmamak.com/v1
API Key: <GATEWAY_API_KEY>
```

The default public models are `mimo-v2.5` and `mimo-v2.5-pro`.

## 9. IP Allowlist

In the admin dashboard, add allowed IPs or CIDR ranges:

```text
192.168.1.50
88.245.10.0/24
2001:db8::/32
```

Leave empty to allow any IP with a valid gateway key. When populated, both gateway key and IP must match.

## 10. Key Order and Failover

Keys are tried strictly in priority order (0 = highest). The router behavior:

| Upstream result | Behavior |
|-----------------|----------|
| 402 | Key marked `exhausted`, removed from rotation |
| 429 | Key `cooldown` for configured seconds |
| 401 | Key marked `invalid` |
| 403 | Key marked `disabled` |
| 5xx / timeout / network error | Temporary cooldown |

After a streaming response starts, no fallback or retry is performed.

## 11. Backup and Restore

The entire application state is in the SQLite file at `/data/mimo-router.sqlite`. Back up this file regularly:

```bash
# Backup
docker cp mimo-api-key-router:/data/mimo-router.sqlite ./mimo-router-backup.sqlite

# Restore (stop container first)
docker cp ./mimo-router-backup.sqlite mimo-api-key-router:/data/mimo-router.sqlite
```

## License

MIT
