# Security

## Secrets

- Store `.env` outside version control and restrict its file permissions.
- Use one stable, unique 32+ character `GATEWAY_KEY`; clients receive this key, never provider credentials.
- Do not change `GATEWAY_KEY` after provider credentials are stored. A separate credential-encryption key is derived from it, so changing it would prevent decryption of existing provider secrets.

Provider credentials are encrypted at rest with a key derived from `GATEWAY_KEY`. Admin passwords and the router-key verifier are stored as Argon2id hashes.

## Network boundaries

- Enable `TRUST_PROXY=true` only behind a trusted proxy that overwrites forwarding headers.
- Enable `COOKIE_SECURE=true` only when the browser reaches the dashboard over HTTPS.
- Keep `ALLOW_PRIVATE_PROVIDER_URLS=false` unless private provider endpoints are a deliberate deployment requirement.
- Use the dashboard IP allowlist to require both a valid router key and an allowed client IP/CIDR.

## Sessions and logging

Admin cookies are HTTP-only and `SameSite=Lax`. Mutating admin requests are CSRF protected. The service logs operational metadata, not provider credentials, gateway keys, passwords, authorization headers, or request bodies.
