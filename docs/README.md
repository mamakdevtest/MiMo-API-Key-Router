# AI Provider Router documentation

The router provides a single authenticated API for multiple upstream AI providers. It keeps provider credentials encrypted and exposes only provider-prefixed public model IDs to clients.

## Guides

- [First-time setup](./first-time-setup.md)
- [Admin dashboard](./admin-dashboard.md)
- [Providers and credentials](./managing-keys.md)
- [Client configuration](./client-configuration.md)
- [Routing and failover](./failover.md)
- [Model benchmark](./model-benchmark.md)
- [Security](./security.md)
- [Coolify deployment](./coolify-deployment.md)
- [Backup and restore](./backup-restore.md)
- [Troubleshooting](./troubleshooting.md)
- [Architecture](./multi-provider-architecture.md)

Use `GET /v1/models` as the source of truth for model IDs. A model is always requested as `provider-slug/upstream-model-id`; unprefixed legacy MiMo model names are not a supported public contract.
