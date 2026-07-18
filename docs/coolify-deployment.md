# Coolify deployment

Deploy the repository as a Dockerfile application or Docker Compose resource. Attach a persistent volume at `/data`; it contains the SQLite database.

## Required environment

Set these values in Coolify secrets/environment settings:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
DATABASE_URL=file:/data/api-router.sqlite
INITIAL_ADMIN_PASSWORD=strong-first-setup-password
GATEWAY_KEY=long-random-client-key
TRUST_PROXY=true
COOKIE_SECURE=true
LOG_LEVEL=info
```

`INITIAL_ADMIN_PASSWORD` is required only while the database is first initialised. Keep `GATEWAY_KEY` stable after that point: it is the one permanent client key and derives the encryption key for stored provider credentials. No additional encryption or session-signing environment secret is required.

## Deploy and verify

1. Configure the application domain and enable HTTPS.
2. Mount persistent storage at `/data`.
3. Deploy and inspect the logs for a successful migration and listener on port `4000`.
4. Request `https://your-domain/health`; it returns `{"status":"ok","app":"AI Provider Router"}`.
5. Sign in, create a provider, add a credential, and synchronize models.

Do not expose the container port directly to the public internet when Coolify's HTTPS proxy is available.
