# 08 - Backup and Restore

All application data is stored in a single SQLite file. Backing up and restoring is straightforward.

## Finding the Database File

| Environment | Path |
|-------------|------|
| Local dev | `./mimo-router.sqlite` (or whatever `DATABASE_URL` points to) |
| Docker | `/data/mimo-router.sqlite` inside the container |

## Backup

### Local

```bash
cp mimo-router.sqlite mimo-router-backup-$(date +%Y%m%d).sqlite
```

### Docker

```bash
docker cp mimo-api-key-router:/data/mimo-router.sqlite ./mimo-router-backup-$(date +%Y%m%d).sqlite
```

## Restore

1. Stop the running server or container.
2. Replace the database file.
3. Restart.

### Local

```bash
# Stop the server first
cp mimo-router-backup-20250707.sqlite mimo-router.sqlite
npm run dev
```

### Docker

```bash
# Stop the container first
docker cp mimo-router-backup-20250707.sqlite mimo-api-key-router:/data/mimo-router.sqlite
docker compose up -d
```

## Important Notes

- The encryption key (`APP_ENCRYPTION_KEY`) is not stored in the database. You must keep it safe separately.
- If you lose the encryption key, you cannot decrypt the stored MiMo API keys.
- Always back up both the database file and the `.env` file together.
