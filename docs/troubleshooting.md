# 09 - Troubleshooting

This guide helps you resolve common issues.

## Backend fails to start with "Invalid environment variables"

**Cause:** Required environment variables are missing or too short.

**Fix:**

1. Make sure `.env` exists in the project root.
2. Set `INITIAL_ADMIN_PASSWORD` on first boot.
3. Restart the server.

## Backend fails to start with "SQLITE_CANTOPEN: unable to open database file"

**Cause:** The application runs as a non-root user `router` (UID `1001`) inside Docker, but the mounted persistent volume folder is owned by `root`.

**Fix:**

1. Run this command on your host server to change the permissions:
   ```bash
   sudo chown -R 1001:1001 /data/coolify/applications/<app-uuid>/storage/data
   ```
2. Alternatively, edit the `Dockerfile` and comment out the `USER router` line to run the container as `root`.
3. Restart the container.

## "Unable to reach server" or HTML response error

**Cause:** The frontend cannot reach the backend.

**Fix:**

1. Make sure the backend is running:
   ```bash
   npm run dev:backend
   ```
2. Check that the frontend proxy in `frontend/vite.config.ts` points to the correct backend port.
3. Check browser console and backend logs for errors.

## 403 Forbidden when adding or editing keys

**Cause:** CSRF token mismatch.

**Fix:**

1. Log out and log in again.
2. Clear browser cookies for the site.
3. Make sure your browser is not blocking cookies.

## Gateway key is rejected

**Cause:** The gateway key was rotated or typed incorrectly.

**Fix:**

1. Check the server logs for the current gateway key (only shown on first boot).
2. If you rotated the key, use the new one from the dashboard.
3. If you lost the key, rotate it again from **Settings → Gateway API Key**.

## All requests return 503

**Cause:** No available MiMo keys.

**Fix:**

1. Open the dashboard and check key states.
2. Reset or enable keys that are `exhausted`, `invalid`, or `disabled`.
3. Add new MiMo keys if needed.

## Key marked exhausted after working before

**Cause:** The MiMo key ran out of credits.

**Fix:**

1. Add a new MiMo key or recharge the existing one.
2. Reset the key state from the dashboard.

## IP allowlist blocks legitimate requests

**Cause:** The allowlist is active and the client IP is not allowed.

**Fix:**

1. Go to **Settings → IP Allowlist**.
2. Add the client IP or CIDR range.
3. If you are behind a reverse proxy, make sure `TRUST_PROXY=true` is set.

## Still stuck?

Check the backend logs for detailed error messages. Only metadata is logged; sensitive values like keys and passwords are never written to logs.
