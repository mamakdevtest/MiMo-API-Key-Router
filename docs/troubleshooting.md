# Troubleshooting

## `Could not locate the bindings file` for `better-sqlite3`

Your native module was not built for the current Node version. Rebuild after approving native scripts (npm 12+):

```bash
npm install-scripts approve --all
npm rebuild better-sqlite3 argon2
```

Use a supported Node version (the project supports Node 20+; current `better-sqlite3` supports Node 20–26).

## `INITIAL_ADMIN_PASSWORD is required for first setup`

The configured database has no settings row. Set `INITIAL_ADMIN_PASSWORD`, restart once, then remove it from the environment if desired. Do not point a production deployment at an empty or unintended database path.

## `EACCES: permission denied, mkdir '/data'`

`/data` is the Docker container's persistent-volume path, not a local development directory. The container entrypoint repairs the mounted volume ownership before dropping to the non-root application user. For `npm run dev`, set this in `.env`:

```text
DATABASE_URL=file:./data/api-router.sqlite
```

Restart the backend. The router creates `./data` in the repository automatically. Keep `file:/data/api-router.sqlite` only for Docker/Coolify, where `/data` is mounted and writable by the container user. If a deployment still logs `mkdir './data'`, remove its stale `DATABASE_URL` value in Coolify or set it explicitly to `file:/data/api-router.sqlite`.

## Vite proxy reports `ECONNREFUSED` for `/admin/me`

The frontend is running but the backend is not. Start it with `npm run dev:backend`, then resolve the backend startup error shown in its output. The development proxy targets port `4000`.

## Model not found

Create and enable the provider, add an active credential, sync its models, and use the exact provider-prefixed ID returned by `/v1/models`.

## Provider cannot be saved or tested

Check the base URL, authentication configuration, and provider credential. Private network endpoints are rejected unless `ALLOW_PRIVATE_PROVIDER_URLS=true`.

## Docker cannot open the database

Confirm `/data` is persistent and writable by the container user. Do not replace the persistent volume during a redeploy.
