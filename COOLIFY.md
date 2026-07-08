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

## 2. Deploy — Method A: Git Repository (Recommended)

This is the easiest method. Coolify pulls from GitHub and builds automatically.

### 2a. Create Resource

1. In Coolify, go to **Resources** → **New Resource**
2. Select **Git Repository**
3. Connect your GitHub repository: `mamakdevtest/MiMo-API-Key-Router`
4. Select branch: `main`
5. Build pack: **Dockerfile**
6. Dockerfile location: `./Dockerfile`

### 2b. Domain & SSL

1. In the resource settings, go to **Domains**
2. Set the domain: `api.ai.emirhanmamak.com`
3. **Port**: `4000`
4. Enable **HTTPS** (Let's Encrypt)
5. Save

### 2c. Environment Variables

Add these in Coolify (Resource → **Environment Variables**):

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

To generate secure keys:

```bash
openssl rand -hex 32
```

### 2d. Persistent Storage

1. Go to **Storage** or **Volumes**
2. Add a persistent volume:
   - Host path or named volume: `mimo-data`
   - Container path: `/data`

### 2e. Deploy

1. Click **Deploy**
2. Wait for build (~3-5 minutes)
3. On first boot, check **Logs** tab for the gateway key:

```text
========================================
Gateway API Key (save this securely):
mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
========================================
```

4. **Copy it immediately.** Never shown again.

---

## 3. Deploy — Method B: Docker Compose (Highly Recommended & Fast)

Deploying via Docker Compose is the most flexible method. If you deploy using `build: .`, Coolify will compile the project from source inside your server. 

> [!WARNING]
> **Why are builds slow on VPS?** 
> Compiling frontend bundles (Vite + TypeScript type-checking) requires significant CPU and memory. On entry-level VPS servers, this process can take several minutes or fail due to memory limits.
>
> **The Solution (Fast Deploys):**
> Build the Docker image once (locally or using GitHub Actions) and push it to a Docker registry (e.g., Docker Hub, GitHub Container Registry). Then, reference the pre-built image in your `docker-compose.yml` instead of building it from source. This reduces deploy time from minutes to **seconds**.

### 3a. Pre-built Image docker-compose.yml
If you have pushed your image (e.g., `username/mimo-api-key-router:latest`), use this compose file:

```yaml
services:
  mimo-router:
    image: username/mimo-api-key-router:latest
    container_name: mimo-api-key-router
    restart: unless-stopped
    ports:
      - "${HOST_IP:-0.0.0.0}:${PORT:-4000}:${PORT:-4000}"
    environment:
      - NODE_ENV=production
      - HOST=${HOST:-0.0.0.0}
      - PORT=${PORT:-4000}
      - DATABASE_URL=${DATABASE_URL:-file:/data/mimo-router.sqlite}
      - APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
      - INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD}
      - GATEWAY_KEY=${GATEWAY_KEY}
      - SESSION_SECRET=${SESSION_SECRET}
      - TRUST_PROXY=${TRUST_PROXY:-true}
      - COOKIE_SECURE=${COOKIE_SECURE:-true}
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - SESSION_MAX_AGE_SECONDS=${SESSION_MAX_AGE_SECONDS:-86400}
      - MIMO_OPENAI_BASE_URL=${MIMO_OPENAI_BASE_URL:-https://api.xiaomimimo.com/v1}
      - MIMO_ANTHROPIC_BASE_URL=${MIMO_ANTHROPIC_BASE_URL:-https://api.xiaomimimo.com/anthropic}
    volumes:
      - mimo-data:/data
    healthcheck:
      test: ["CMD", "./healthcheck.sh"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  mimo-data:
```

### 3b. How to Setup in Coolify Dashboard

Follow these steps exactly in the Coolify UI to deploy this Docker Compose stack:

1. **Create New Resource:**
   - In the Coolify sidebar, click **Resources**.
   - Click **+ New**.
   - Select **Docker Compose**.

2. **Paste Compose Configuration:**
   - Under **Source**, choose **Raw Docker Compose** (or connect your git repo if building from source).
   - Paste the contents of your `docker-compose.yml` into the editor.
   - Click **Save**.

3. **Configure Domains & Reverse Proxy:**
   - Go to the **General** tab of your new resource.
   - Scroll down to **Domains**.
   - Enter your domain: `https://api.ai.emirhanmamak.com` (Coolify handles Let's Encrypt HTTPS automatically).
   - In the service port mappings, ensure the container port matches `4000`.

4. **Define Environment Variables:**
   - Go to the **Environment Variables** tab.
   - Add the following keys:
     - `APP_ENCRYPTION_KEY`: A secure 32+ character key.
     - `INITIAL_ADMIN_PASSWORD`: Admin dashboard login password.
     - `SESSION_SECRET`: Session cookie secret (32+ characters).
     - `HOST_IP`: **Set this to the host IP you want the container to bind to** (e.g. `0.0.0.0` to listen on all interfaces, or `127.0.0.1` to restrict access through Coolify's reverse proxy only).
     - `GATEWAY_KEY` *(Optional)*: **Set a static master gateway API key** (e.g. `mimo_yourcustomkey123`). If you provide this, no random key is printed on startup, and this key works immediately. If not provided, you can create and manage all keys dynamically from the admin panel under **Gateway Credentials**.
     - `TRUST_PROXY`: `true`
     - `COOKIE_SECURE`: `true` (Since we use HTTPS)

5. **Deploy:**
   - Click **Deploy** in the top right corner.
   - The deployment will pull the pre-built image and start the container instantly.

---

## 4. Verify Deployment

### Check health endpoint:

```bash
curl https://api.ai.emirhanmamak.com/health
# Should return: {"status":"ok"}
```

### Check admin login:

- Open `https://api.ai.emirhanmamak.com` in browser
- You should see the login page
- Log in with `INITIAL_ADMIN_PASSWORD`

### Check models endpoint:

```bash
curl https://api.ai.emirhanmamak.com/v1/models \
  -H "Authorization: Bearer <YOUR_GATEWAY_KEY>"
```

## 5. Troubleshooting

### ERR_SSL_PROTOCOL_ERROR

- **Certificate not issued yet:** Check Coolify → Resource → SSL/TLS. Wait 1-5 minutes.
- **DNS not pointing to server:** Run `nslookup api.ai.emirhanmamak.com` on your server.
- **Reverse proxy not configured:** Ensure domain and port `4000` are set. Redeploy.

### Container keeps restarting

- `INITIAL_ADMIN_PASSWORD` not set → crashes on first boot
- `APP_ENCRYPTION_KEY` too short (< 32 chars) → crashes
- **SQLite Database Permission Denied:** If logs show `SQLITE_CANTOPEN: unable to open database file` or permission denied errors, the mounted host directory volume `/data` is owned by `root` instead of the container's non-root user `router` (UID `1001`).
  - *Fix Option A (Recommended):* Run this command on your host server to change the permissions:
    ```bash
    sudo chown -R 1001:1001 /data/coolify/applications/<app-uuid>/storage/data
    ```
  - *Fix Option B:* Edit the `Dockerfile` and comment out the `USER router` line to run the container as `root`.

### Admin login doesn't work

- `COOKIE_SECURE=true` (not `false`)
- `TRUST_PROXY=true`
- Clear browser cookies and try again

### Build fails with `tsc: not found`

- Make sure you're using the latest Dockerfile from the repository
- The builder stage installs devDependencies with `--include=dev`

### Gateway key not showing in logs

- Check Coolify resource logs (not deployment logs)
- Only printed on FIRST boot
- If redeployed without persistent storage, DB was reset

### Health check failing

- Healthcheck hits `localhost:4000/health`
- Ensure `PORT=4000` is set
- Check app started successfully in logs

## 6. Security Notes

- Never expose port 4000 directly to the internet
- Always use Coolify's reverse proxy for HTTPS
- Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` in production
- Back up `/data/mimo-router.sqlite` regularly
