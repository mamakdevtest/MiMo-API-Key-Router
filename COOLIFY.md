# Coolify Deployment Guide

## Prerequisites

- A server with Coolify installed and running
- A domain name (e.g. `api.ai.emirhanmamak.com`) with DNS A record pointing to your server's public IP
- Docker 29+ with BuildKit enabled

## 1. DNS Setup

Before deploying, make sure your domain points to your server:

```bash
# On your server, verify DNS:
nslookup api.ai.emirhanmamak.com

# Should return your server's public IP address
# If not, update your DNS A record first and wait for propagation (5-30 min)
```

## 2. Create Resource in Coolify

1. Go to **Resources** → **New Resource**
2. Select **Git Repository** (not Docker Compose)
3. Connect your GitHub repository: `mamakdevtest/MiMo-API-Key-Router`
4. Select branch: `main`
5. Build pack: **Dockerfile**
6. Dockerfile location: `./Dockerfile`

## 3. Domain & SSL Configuration

1. In the resource settings, go to **Domains**
2. Set the domain: `api.ai.emirhanmamak.com`
3. **Port**: `4000`
4. Enable **HTTPS** (Let's Encrypt)
5. Save and wait for the SSL certificate to be issued (1-5 minutes)

> **Important:** Coolify must successfully obtain the SSL certificate before the site will work over HTTPS.
> If you see `ERR_SSL_PROTOCOL_ERROR`, the certificate may not be ready yet. Check the SSL status in Coolify dashboard.

## 4. Environment Variables

Add these environment variables in Coolify (Resource → **Environment Variables**):

```text
APP_ENCRYPTION_KEY=<generate a random 32+ char string>
INITIAL_ADMIN_PASSWORD=<set a strong admin password>
SESSION_SECRET=<generate a random 32+ char string>
TRUST_PROXY=true
COOKIE_SECURE=true
NODE_ENV=production
PORT=4000
DATABASE_URL=file:/data/mimo-router.sqlite
LOG_LEVEL=info
SESSION_MAX_AGE_SECONDS=86400
MIMO_OPENAI_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/anthropic
```

> **⚠️ CRITICAL:** `COOKIE_SECURE` MUST be `true` when using HTTPS.
> If set to `false`, admin login will not work because cookies won't be set over HTTPS.

To generate secure keys, run:

```bash
# On your server:
openssl rand -hex 32
```

## 5. Persistent Storage

1. In Coolify, go to **Storage** or **Volumes**
2. Add a persistent volume mapping:
   - Host path or named volume: `mimo-data`
   - Container path: `/data`
3. This keeps the SQLite database alive across container restarts and redeploys

## 6. Deploy

1. Click **Deploy** in Coolify
2. Wait for the build to complete (~3-5 minutes)
3. Check the **Logs** tab — on first boot you will see:

```text
========================================
Gateway API Key (save this securely):
mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
========================================
```

4. **Copy this key immediately.** It is never shown again.

## 7. Verify Deployment

### Check health endpoint:
```bash
curl https://api.ai.emirhanmamak.com/health
# Should return: {"status":"ok"}
```

### Check admin login:
- Open `https://api.ai.emirhanmamak.com` in browser
- You should see the login page
- Log in with the `INITIAL_ADMIN_PASSWORD` you set

### Check models endpoint:
```bash
curl https://api.ai.emirhanmamak.com/v1/models \
  -H "Authorization: Bearer <YOUR_GATEWAY_KEY>"
```

## Troubleshooting

### ERR_SSL_PROTOCOL_ERROR

This means the browser can't establish an HTTPS connection. Common causes:

1. **SSL certificate not issued yet**
   - Check Coolify dashboard → Resource → SSL/TLS
   - If pending, wait 1-5 minutes
   - If failed, click "Issue Certificate" or check DNS

2. **DNS not pointing to server**
   - Run `nslookup api.ai.emirhanmamak.com` on your server
   - The IP must match your server's public IP
   - Wait for DNS propagation after changing

3. **Coolify reverse proxy not configured**
   - Ensure domain is set in Coolify resource settings
   - Ensure port is set to `4000`
   - Redeploy after making changes

### Container keeps restarting

Check Coolify logs for errors:
- `INITIAL_ADMIN_PASSWORD` not set → app crashes on first boot
- `APP_ENCRYPTION_KEY` not set or too short (< 32 chars) → app crashes

### Admin login doesn't work

- Ensure `COOKIE_SECURE=true` (not `false`)
- Ensure `TRUST_PROXY=true`
- Clear browser cookies and try again
- Check that the session cookie is being set (browser DevTools → Application → Cookies)

### Gateway key not showing in logs

- Check Coolify resource logs (not deployment logs)
- The key is only printed on FIRST boot
- If you redeployed without persistent storage, the DB was reset and a new key was generated

### Health check failing

- The healthcheck hits `localhost:4000/health`
- Ensure `PORT=4000` is set
- Check that the app started successfully in logs

## Security Notes

- Never expose port 4000 directly to the internet
- Always use Coolify's reverse proxy for HTTPS termination
- Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` in production
- Regularly back up the SQLite database at `/data/mimo-router.sqlite`
