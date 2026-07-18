# Admin dashboard

The dashboard manages upstream providers, their encrypted credentials, and client-facing router keys. Sign in using the password supplied by `INITIAL_ADMIN_PASSWORD` when the database was first created.

## Main areas

| Area | Use |
|---|---|
| Overview | Gateway health, credential states, request volume, and recent success rate |
| Providers | Create, edit, test, enable, disable, and inspect providers |
| Model catalog | View synchronized models and their public IDs |
| Router keys | Rotate the main key and manage temporary client keys |
| Settings | Change the admin password, cooldowns, timeouts, and IP allowlist |

## Provider workflow

Create a provider first, then add its credentials. Test a credential and synchronize models before clients use it. The router never returns a provider secret to the browser after it has been saved.

Provider slugs are lowercase letters, digits, and hyphens. They form the first segment of every public model ID.

## Sessions

Admin sessions use HTTP-only cookies. State-changing dashboard calls require a CSRF token. If a request is rejected after a deployment or domain change, sign out, clear site cookies, and sign in again.
