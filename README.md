# MiMo API Key Router

A production-ready, single-container API gateway that proxies OpenAI/Anthropic-compatible client requests to Xiaomi MiMo using a pool of pay-as-you-go API keys.

## Features

- **Single gateway API key** for all clients — real MiMo keys never exposed
- **Encrypted storage** of MiMo keys (AES-256-GCM)
- **Ordered key failover** with cooldown/exhausted/invalid/disabled states
- **Anthropic-compatible** `/v1/messages` and `/v1/models` (Claude Code)
- **OpenAI-compatible** `/v1/chat/completions`, `/v1/models`, `/health` (Open WebUI)
- **Admin dashboard** with dark, minimal UI
- **IP allowlist** with CIDR support (IPv4/IPv6)
- **Streaming support** — SSE pass-through for streaming responses
- **SQLite** database with WAL mode
- **Single Dockerfile** + docker-compose for easy deployment

## Tech Stack

- **Backend:** TypeScript + Fastify 5
- **Frontend:** React 18 + Vite 6 + Tailwind CSS 3 + shadcn/ui
- **Database:** SQLite (better-sqlite3) + Drizzle ORM
- **Crypto:** AES-256-GCM (key encryption), Argon2id (password/hashing)
- **Deployment:** Multi-stage Docker (node:20-alpine), Coolify-ready

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

The backend runs on `http://localhost:4000` and the frontend dev server on `http://localhost:4173`.

## 2. Docker

```bash
# Build and run
cp .env.example .env
# Edit .env with your secrets

docker compose up --build -d
```

The container exposes port `4000` and persists data in `/data`.

## 3. Coolify Setup

See [COOLIFY.md](./COOLIFY.md) for detailed Coolify deployment instructions.

## 4. Domain Binding

Point your domain (e.g. `api.ai.emirhanmamak.com`) to your Coolify server. Coolify will handle HTTPS termination and reverse proxy to the container on port `4000`.

## 5. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ENCRYPTION_KEY` | Yes | 32+ char key for encrypting MiMo API keys |
| `INITIAL_ADMIN_PASSWORD` | First boot | Admin dashboard password |
| `SESSION_SECRET` | Production | Secret for signing session cookies (min 32 chars) |
| `PORT` | No | Server port, default `4000` |
| `DATABASE_URL` | No | SQLite path, default `file:/data/mimo-router.sqlite` |
| `TRUST_PROXY` | No | Trust `X-Forwarded-For` from reverse proxy (default `false`) |
| `COOKIE_SECURE` | No | Use secure cookies (default `false`, set `true` with HTTPS) |
| `LOG_LEVEL` | No | Pino log level (default `info`) |
| `SESSION_MAX_AGE_SECONDS` | No | Session lifetime in seconds (default `86400`) |
| `MIMO_OPENAI_BASE_URL` | No | Default `https://api.xiaomimimo.com/v1` |
| `MIMO_ANTHROPIC_BASE_URL` | No | Default `https://api.xiaomimimo.com/anthropic` |
| `MIMO_AUTH_HEADER` | No | Auth header name (default `Authorization`) |
| `MIMO_AUTH_PREFIX` | No | Auth header prefix (default `Bearer `) |

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

### Method 1: Environment Variables

```bash
export ANTHROPIC_BASE_URL=https://api.ai.emirhanmamak.com
export ANTHROPIC_AUTH_TOKEN=<GATEWAY_API_KEY>
export ANTHROPIC_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=mimo-v2.5
```

### Method 2: Project settings.json (Recommended)

Create `.claude/settings.json` in your project root:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.ai.emirhanmamak.com",
    "ANTHROPIC_AUTH_TOKEN": "<GATEWAY_API_KEY>",
    "ANTHROPIC_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mimo-v2.5"
  }
}
```

Then start Claude Code normally. It will use your router as the Anthropic endpoint.

## 8. Open WebUI Configuration

In Open WebUI, add an OpenAI API connection:

```text
OpenAI Base URL: https://api.ai.emirhanmamak.com/v1
API Key: <GATEWAY_API_KEY>
```

The default public models are `mimo-v2.5` and `mimo-v2.5-pro`. You can toggle additional models (ASR, TTS) from the admin dashboard Settings page.

## 9. IP Allowlist

In the admin dashboard, add allowed IPs or CIDR ranges:

```text
192.168.1.50
88.245.10.0/24
2001:db8::/32
```

Leave empty to allow any IP with a valid gateway key. When populated, both gateway key and IP must match.

Behind Coolify's reverse proxy, `X-Forwarded-For` is used safely when `TRUST_PROXY=true`.

## 10. Key Order and Failover

Keys are tried strictly in priority order (0 = highest). The router behavior:

| Upstream result | Behavior |
|-----------------|----------|
| 200 | Success — stream response back |
| 402 | Key marked `exhausted`, try next key |
| 429 | Key `cooldown` for configured seconds, try next key |
| 401 | Key marked `invalid`, try next key |
| 403 | Key marked `disabled`, try next key |
| 5xx / timeout / network error | Temporary cooldown, try next key |
| All keys fail | Return `503 Service Unavailable` |

**Streaming safety:** After a streaming response starts, no fallback or retry is performed. This prevents duplicate tool execution and inconsistent agent flows in Claude Code.

**Cooldown auto-reset:** Keys in cooldown automatically become available again after the configured cooldown period expires.

## 11. Backup and Restore

The entire application state is in the SQLite file at `/data/mimo-router.sqlite`. Back up this file regularly:

```bash
# Backup
docker cp mimo-api-key-router:/data/mimo-router.sqlite ./mimo-router-backup.sqlite

# Restore (stop container first)
docker cp ./mimo-router-backup.sqlite mimo-api-key-router:/data/mimo-router.sqlite
```

## Available Models

| Model ID | Description | Public by Default |
|----------|-------------|-------------------|
| `mimo-v2.5` | General chat model | Yes |
| `mimo-v2.5-pro` | Advanced chat model | Yes |
| `mimo-v2.5-asr` | Speech recognition | No |
| `mimo-v2.5-tts` | Text-to-speech | No |
| `mimo-v2.5-tts-voiceclone` | Voice cloning | No |
| `mimo-v2.5-tts-voicedesign` | Voice design | No |

Private models can be enabled in the dashboard and accessed directly by clients using the model ID.

## License

MIT
