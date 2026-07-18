# Security

## Secrets

- Store `.env` outside version control and restrict its file permissions.
- Set stable, unique 32+ character values for `APP_ENCRYPTION_KEY` and `SESSION_SECRET`.
- Do not change `APP_ENCRYPTION_KEY` after provider credentials are stored; the existing secrets can no longer be decrypted without the old key.
- Use a long random `GATEWAY_KEY`; clients receive this key, never provider credentials.

Provider credentials are encrypted at rest. Admin passwords and gateway keys are stored as Argon2id hashes.

## Network boundaries

- Enable `TRUST_PROXY=true` only behind a trusted proxy that overwrites forwarding headers.
- Enable `COOKIE_SECURE=true` only when the browser reaches the dashboard over HTTPS.
- Keep `ALLOW_PRIVATE_PROVIDER_URLS=false` unless private provider endpoints are a deliberate deployment requirement.
- Use the dashboard IP allowlist to require both a valid router key and an allowed client IP/CIDR.

## Sessions and logging

Admin cookies are HTTP-only and `SameSite=Lax`. Mutating admin requests are CSRF protected. The service logs operational metadata, not provider credentials, gateway keys, passwords, authorization headers, or request bodies.
