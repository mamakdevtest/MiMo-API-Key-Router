# Backup and restore

The persistent state is the SQLite database selected by `DATABASE_URL`. In the container configuration it is `/data/api-router.sqlite`.

## Back up

Stop writes or take a SQLite-consistent backup before copying the file. Keep the database backup together with the permanent `GATEWAY_KEY` in a secure secret store.

```bash
docker cp api-router:/data/api-router.sqlite ./router-backup.sqlite
```

For a local database, copy the path from `DATABASE_URL` after stopping the server.

## Restore

1. Stop the service.
2. Replace the database file with the backup.
3. Restore the original `GATEWAY_KEY` and necessary runtime secrets.
4. Start the service and verify `/health`, dashboard login, and a provider credential test.

If the permanent router key is lost, encrypted provider credentials in the database cannot be recovered.
