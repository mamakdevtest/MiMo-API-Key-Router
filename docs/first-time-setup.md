# First-time setup

## Requirements

- Node.js 20 or later
- npm
- Docker is optional for production deployment

## Local development

```bash
npm install
cp .env.example .env
```

Set these values in `.env` before the first start:

- `INITIAL_ADMIN_PASSWORD`
- `GATEWAY_KEY`
- `APP_ENCRYPTION_KEY` (32+ characters)
- `SESSION_SECRET` (32+ characters)

On npm 12+, approve the repository's native build scripts if npm reports blocked scripts:

```bash
npm install-scripts approve --all
npm rebuild
```

Start both services:

```bash
npm run dev
```

The API is `http://localhost:4000`; the development dashboard is `http://localhost:4173`. Migrations run automatically at startup, so no separate migration command is necessary for normal setup. Keep the local `DATABASE_URL` as `file:./data/mimo-router.sqlite`; `/data` is the Docker-only persistent volume path.

## Configure providers

1. Sign in to the dashboard.
2. Add a provider, including its type, name, unique slug, and base URL.
3. Add credentials under that provider and test one.
4. Synchronize the provider's models.
5. Copy a public model ID from the model catalog and use it in a client.

The public ID contains the provider slug, for example `mimo-main/mimo-v2.5-pro`.

## Production

```bash
npm run build
npm start
```

For containers, persist `/data` and use `NODE_ENV=production`, `TRUST_PROXY=true`, and `COOKIE_SECURE=true` only when HTTPS is terminated by a trusted reverse proxy.
