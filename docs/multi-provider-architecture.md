# Architecture

AI Provider Router separates the client protocol from the upstream provider.

```text
Client (OpenAI or Anthropic)
        ↓
Gateway authentication and protocol normalization
        ↓
Public model resolver: provider-slug/upstream-model-id
        ↓
Provider credential selection and failover
        ↓
Provider adapter
        ↓
Upstream provider
```

## Provider model

- A **provider type** is an adapter family: MiMo, Featherless, OrcaRouter, or generic OpenAI-compatible.
- A **provider** is a configured instance with its own slug, base URL, capabilities, health status, and settings.
- A **credential** belongs to one provider and is encrypted at rest.
- A **public model ID** names the provider instance and its upstream model: `slug/upstream-model-id`.

Provider adapters translate canonical requests and responses, handle upstream model discovery, classify upstream errors, and expose provider capabilities. The routing layer owns selection, retry, credential state, and request logging; adapters never expose or authenticate dashboard sessions.

## Current API boundary

The public chat boundary is OpenAI-compatible `/v1/chat/completions` and Anthropic-compatible `/v1/messages`. The service lists public model IDs through `/v1/models`. Legacy, unprefixed MiMo model names are not part of the new routing contract.
