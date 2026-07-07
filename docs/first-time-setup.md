# 01 - First Time Setup

This guide walks you through running MiMo API Key Router for the first time on your local machine.

## Prerequisites

- Node.js 20+ installed
- npm installed
- (Optional) Docker and Docker Compose

## 1. Install Dependencies

```bash
npm install
```

## 2. Create Environment File

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env` and set the required values:

```text
APP_ENCRYPTION_KEY=your-random-32-char-key-here
INITIAL_ADMIN_PASSWORD=your-strong-admin-password
SESSION_SECRET=another-random-32-char-key
```

> **Important:** `APP_ENCRYPTION_KEY` must be at least 32 characters long. It is used to encrypt your real MiMo API keys.

## 3. Run Database Migrations

```bash
npm run db:migrate
```

This creates the SQLite database file.

## 4. Start the Server

### Development mode (recommended for local use)

```bash
npm run dev
```

This starts:

- Backend at `http://localhost:4000`
- Frontend dev server at `http://http://localhost:4173`

### Production mode

```bash
npm run build
npm start
```

The production server runs on `http://localhost:4000` (or whatever `PORT` you set).

## 5. Get Your Gateway API Key

On first startup, the gateway API key is printed in the terminal logs:

```text
========================================
Gateway API Key (save this securely):
mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
========================================
```

Copy this value immediately. It is shown only once.

## 6. Log in to the Admin Dashboard

Open the frontend URL in your browser:

```text
http://localhost:4173
```

Enter the `INITIAL_ADMIN_PASSWORD` you set in `.env`.

## Next Steps

- [Add MiMo API keys](./managing-keys.md)
- [Configure Claude Code or Open WebUI](./client-configuration.md)
