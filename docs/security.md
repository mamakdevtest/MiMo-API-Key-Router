# 06 - Security Settings

This guide covers the security features available in MiMo API Key Router.

## Gateway API Key

The gateway API key is the only key your clients need. It is stored as an Argon2id hash in the database.

- It is shown **only once** on first server startup.
- It is **never** displayed in the dashboard in full.
- You can rotate it from **Settings → Gateway API Key**.
- Rotating immediately invalidates the old key.

## Admin Password

The admin password is hashed with Argon2id. Change it from **Settings → Admin Password**.

## MiMo Key Encryption

Real MiMo API keys are encrypted with AES-256-GCM before being stored in SQLite. The encryption key comes from the `APP_ENCRYPTION_KEY` environment variable.

> Never commit `APP_ENCRYPTION_KEY` to version control.

## IP Allowlist

You can restrict API access by IP address or CIDR range.

1. Go to **Settings → IP Allowlist**.
2. Enter one or more entries, separated by commas or new lines:

```text
192.168.1.50
88.245.10.0/24
2001:db8::/32
```

3. Click **Save Allowlist**.

When the allowlist is empty, only the gateway API key is required. When it has entries, both the key and the client IP must match.

## Reverse Proxy Handling

When running behind Coolify or another reverse proxy, set `TRUST_PROXY=true`. The router then reads the client IP from `X-Forwarded-For` safely.

## Session Security

- Admin sessions use HttpOnly cookies.
- Cookies are marked `SameSite=Lax`.
- In production with HTTPS, set `COOKIE_SECURE=true`.
- All mutating admin requests require a CSRF token.

## What Is Never Logged

- MiMo API keys
- Gateway API key
- Admin password
- Encryption key
- Authorization headers
- Request/response bodies

Only technical metadata is logged: request ID, timestamp, route, model, selected key ID, status code, latency, streaming flag, fallback flag, and client IP.
