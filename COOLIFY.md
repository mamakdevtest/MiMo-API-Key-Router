# Coolify Deployment Notes

## 1. Create Resource
- In Coolify, create a new **Resource** → **Docker Compose** or **Dockerfile**.
- Point to your repository `mamakdevtest/MiMo-API-Key-Router`.
- Select the `main` branch.

## 2. Domain
- Set domain to `api.ai.emirhanmamak.com`.
- Enable HTTPS (Coolify will issue a Let's Encrypt certificate).

## 3. Environment Variables
Add the following environment variables in Coolify:

```text
APP_ENCRYPTION_KEY=<random 32+ chars>
INITIAL_ADMIN_PASSWORD=<strong admin password>
SESSION_SECRET=<random 32+ chars>
TRUST_PROXY=true
COOKIE_SECURE=true
NODE_ENV=production
PORT=4000
DATABASE_URL=file:/data/mimo-router.sqlite
MIMO_OPENAI_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/anthropic
```

## 4. Persistent Storage
- Mount a persistent volume to `/data` inside the container.
- This keeps the SQLite database across redeploys.

## 5. First Boot
- On first deploy, the container logs will print the gateway API key.
- Copy it immediately; it is never shown again in full.

## 6. Healthcheck
- The Dockerfile includes a `HEALTHCHECK` that hits `/health`.
- Coolify will use this to monitor the service.

## 7. Reverse Proxy
- Coolify acts as the reverse proxy and terminates HTTPS.
- `TRUST_PROXY=true` ensures `X-Forwarded-For` is used safely for IP allowlist.
- Do not expose port 3000 directly to the internet.
