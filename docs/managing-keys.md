# 03 - Managing Provider API Keys

The router no longer uses one global upstream key pool. Each provider owns its own real API keys, and the router selects only from that provider's pool when a prefixed public model ID points there.

## Adding Provider Keys

1. Go to **Providers** in the dashboard.
2. Create or open a provider such as MiMo or Featherless.
3. Click **Add Key** or **Bulk Import**.
4. Fill in the form:
   - **Label** — a friendly name, e.g. `Main Key` or `Backup 1`
   - **Provider API Key** — the real upstream `sk-...` key for that provider
   - **Priority** — `0` is highest; lower numbers are tried first
5. Click **Save provider key**.

> The real key is shown only during entry. After saving, only a masked version is displayed.

## Testing and Syncing

From the provider details page you can:

- **Test** — validates the currently selected provider credential against the upstream API
- **Sync Models** — pulls the provider's model list into the local model catalog

## Key States

| State | Meaning |
|-------|---------|
| `active` | Key is available for use |
| `cooldown` | Key failed temporarily and will retry after the cooldown period |
| `exhausted` | Key returned 402 (payment required); removed from rotation until manually reset |
| `disabled` | Key was manually disabled |
| `invalid` | Key returned 401 (unauthorized); removed from rotation until manually reset |

## How Routing Uses These Keys

- A client sends a request with a router key.
- The request references a prefixed public model ID, such as `mimo-main/mimo-v2.5-pro`.
- The router resolves that model to the owning provider.
- Only that provider's credentials are considered for routing and failover.

## Best Practices

- Keep at least one backup key per provider.
- Use clear provider-specific labels.
- Run **Test** after adding new keys.
- Run **Sync Models** after changing provider accounts or permissions.
