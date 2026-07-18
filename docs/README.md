# MiMo API Key Router — Documentation

Welcome to the MiMo API Key Router documentation. This folder contains step-by-step guides for installing, configuring, and using the router in real-world scenarios.

## Quick Navigation

- [01 - First Time Setup](./first-time-setup.md)
- [02 - Admin Dashboard Guide](./admin-dashboard.md)
- [03 - Adding and Managing MiMo API Keys](./managing-keys.md)
- [04 - Client Configuration](./client-configuration.md)
  - [Claude Code](./client-configuration.md#claude-code)
  - [Open WebUI](./client-configuration.md#open-webui)
  - [Generic OpenAI Client](./client-configuration.md#generic-openai-client)
  - [Generic Anthropic Client](./client-configuration.md#generic-anthropic-client)
- [05 - Failover and Key States](./failover.md)
- [06 - Security Settings](./security.md)
- [07 - Coolify Deployment](./coolify-deployment.md)
- [08 - Backup and Restore](./backup-restore.md)
- [09 - Troubleshooting](./troubleshooting.md)

## What is MiMo API Key Router?

MiMo API Key Router is a single-container gateway that sits between your AI clients (Claude Code, Open WebUI, etc.) and Xiaomi MiMo. It lets you:

- Use **one gateway API key** across all clients.
- Store **multiple real MiMo keys** securely (encrypted at rest).
- Automatically **fail over** between MiMo keys when one hits a limit or fails.
- Manage everything through a **web admin dashboard**.

## Typical Flow

```text
Claude Code / Open WebUI
        │
        ▼
  Gateway API Key
        │
        ▼
MiMo API Key Router (port 4000 dev / 3000 prod)
        │
        ▼
   Xiaomi MiMo API
```

## Support

If you run into issues, check the [Troubleshooting](./troubleshooting.md) guide first.
