# Providers and credentials

Each provider has its own credential pool. A request for `provider-slug/model-id` can only use credentials assigned to `provider-slug`.

## Supported provider types

- `mimo`
- `featherless`
- `orcarouter`
- `openai_compatible`

For a custom OpenAI-compatible provider, configure the base URL and optional authentication header, prefix, endpoint paths, custom headers, and timeout in the provider form. URLs are validated to reduce SSRF risk. Set `ALLOW_PRIVATE_PROVIDER_URLS=true` only for intentionally private upstream services.

## Credentials

Use **Providers → credentials** to add one key or bulk import keys. Credentials are encrypted at rest and later displayed only in masked form. Priority `0` is tried before higher values.

| State | Routing behaviour |
|---|---|
| `active` | Eligible for requests |
| `cooldown` | Temporarily skipped until the cooldown expires |
| `exhausted` | Skipped until manually reset |
| `invalid` | Skipped until manually reset or replaced |
| `disabled` | Skipped until enabled |

Test a credential after creating it, then synchronize models. The model catalog, not a hard-coded list, determines the current public model IDs.
