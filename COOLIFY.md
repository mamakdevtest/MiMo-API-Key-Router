# Coolify deployment

Use the repository Dockerfile or `docker-compose.yaml` in Coolify. The application listens on port `4000` and serves the dashboard and API from the same deployment.

## Configure

1. Create a new application from this Git repository.
2. Set the public domain and enable HTTPS.
3. Add a persistent volume mounted at `/data`.
4. Configure the environment variables listed in [the deployment guide](./docs/coolify-deployment.md).
5. Deploy, then confirm `GET /health` returns HTTP 200.

Set `TRUST_PROXY=true` and `COOKIE_SECURE=true` for the Coolify HTTPS proxy. Use one persistent, 32+ character `GATEWAY_KEY`. It is the only client key and derives an independent credential-encryption key; do not replace it after provider credentials are stored.

The Docker Compose file sets operational defaults, but it does not inject deployment secrets. Provide `INITIAL_ADMIN_PASSWORD` for first setup and `GATEWAY_KEY` through Coolify's environment configuration.
