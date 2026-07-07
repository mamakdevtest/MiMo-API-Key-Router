# 02 - Admin Dashboard Guide

The admin dashboard is where you manage MiMo API keys, monitor gateway health, and configure settings.

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
| Gateway Status | `healthy` if at least one key is active; `degraded` otherwise |
| Total Keys | Number of MiMo keys stored |
| Active Keys | Keys currently available for routing |
| Cooldown Keys | Keys temporarily paused due to errors |
| Exhausted Keys | Keys that returned 402 (out of credits) |
| Requests (24h) | Total requests in the last 24 hours |
| Success Rate | Percentage of successful requests |

## Navigation

The top bar has three sections:

- **Dashboard** — overview and stats
- **API Keys** — add, edit, reorder, enable/disable keys
- **Settings** — cooldowns, timeouts, IP allowlist, public models, gateway key rotation, password change

## Logging Out

Click the **Logout** button in the top-right corner.

## Security Notes

- The dashboard is protected by a password stored as an Argon2id hash.
- Sessions use secure, HttpOnly cookies.
- All mutating requests require a valid CSRF token.
