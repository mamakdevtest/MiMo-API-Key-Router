# 02 - Admin Dashboard Guide

The admin dashboard is where you manage provider API keys, monitor router health, sync provider models, and control the client-facing router keys.

## Logging In

1. Open the dashboard URL:
   - Development: `http://localhost:4173`
   - Production: your configured domain, e.g. `https://api.ai.emirhanmamak.com`
2. Enter your admin password.
3. Click **Login**.

## Dashboard Overview

After logging in, you see several cards:

| Card | Meaning |
|------|---------|
| Gateway Status | `healthy` if at least one provider credential is active; `degraded` otherwise |
| Total Keys | Number of provider credentials stored across all providers |
| Active Keys | Credentials currently available for routing |
| Cooldown Keys | Credentials temporarily paused due to errors |
| Exhausted Keys | Credentials that returned 402 (out of credits) |
| Requests (24h) | Total requests in the last 24 hours |
| Success Rate | Percentage of successful requests |

## Navigation

The top bar has these main sections:

- **Overview** — router health and request analytics
- **Providers** — add MiMo or Featherless providers, manage provider-owned keys, test them, and sync models
- **Model Catalog** — read-only list of synced provider models and their prefixed public IDs
- **Router Keys** — rotate the main router key and open temporary router key management
- **Settings** — cooldowns, timeouts, IP allowlist, router key rotation, password change

## Routing Model

- Clients use only the router key or temporary router keys.
- Real upstream provider keys stay inside the provider records.
- Public model IDs are prefixed with the provider slug, such as `mimo-main/mimo-v2.5-pro`.
- The router reads the model prefix, finds the owning provider, and forwards the request with that provider's own key pool.

## Logging Out

Click the **Logout** button in the top-right corner.

## Security Notes

- The dashboard is protected by a password stored as an Argon2id hash.
- Sessions use secure, HttpOnly cookies.
- All mutating requests require a valid CSRF token.
