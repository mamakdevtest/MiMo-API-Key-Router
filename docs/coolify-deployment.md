# 07 - Coolify Deployment

This guide explains how to deploy MiMo API Key Router on Coolify.

## 1. Push Code to GitHub

Make sure your repository is on GitHub and accessible by Coolify.

## 2. Create a New Resource in Coolify

1. Open your Coolify dashboard.
2. Click **New Resource**.
3. Choose **Docker Compose** or **Dockerfile** deployment.
4. Select your repository and the `main` branch.

## 3. Set the Domain

In the resource settings, set:

```text
Domain: api.ai.emirhanmamak.com
```

Enable HTTPS so Coolify can issue a Let's Encrypt certificate.

## 4. Add Environment Variables

Add the following variables in Coolify:

```text
INITIAL_ADMIN_PASSWORD=your-strong-admin-password
NODE_ENV=production
PORT=4000
DATABASE_URL=file:/data/mimo-router.sqlite
TRUST_PROXY=true
COOKIE_SECURE=true
```

## 5. Configure Persistent Storage

Mount a persistent volume to `/data` inside the container. This keeps the SQLite database across redeploys.

## 6. Deploy

Click **Deploy**. Coolify will build the Docker image and start the container.

## 7. Create API Keys

Open the domain in your browser and log in using `INITIAL_ADMIN_PASSWORD`. Then, go to **Gateway Credentials** to create and manage your API keys, or pre-configure a static key via the `GATEWAY_KEY` environment variable.

## 8. Verify

Visit `https://api.ai.emirhanmamak.com/health`. You should see:

```json
{ "status": "ok" }
```

## Updating

Push changes to GitHub and redeploy from Coolify. The `/data` volume will persist your database.
