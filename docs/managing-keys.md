# 03 - Adding and Managing MiMo API Keys

MiMo API Key Router uses a pool of real MiMo `sk-...` keys. The gateway picks the highest-priority available key for each request.

## Adding a Key

1. Go to **API Keys** in the dashboard.
2. Click **Add Key**.
3. Fill in the form:
   - **Label** — a friendly name, e.g. "Main Key" or "Backup 1"
   - **MiMo API Key** — the real `sk-...` key from Xiaomi MiMo
   - **Priority** — `0` is highest; lower numbers are tried first
4. Click **Save Key**.

> The real key is shown only during entry. After saving, only a masked version like `sk-****7A9F` is displayed.

## Reordering Keys

Keys are always tried from top to bottom. Use the **Up** and **Down** arrows to change the order.

## Key Actions

Each key row has action buttons:

| Button | Effect |
|--------|--------|
| Up / Down | Change priority order |
| Power | Enable a disabled/invalid/exhausted key |
| Power Off | Disable a key manually |
| Rotate | Reset cooldown/error state |
| Trash | Delete the key permanently |

## Key States

| State | Meaning |
|-------|---------|
| `active` | Key is available for use |
| `cooldown` | Key failed temporarily and will retry after the cooldown period |
| `exhausted` | Key returned 402 (payment required); removed from rotation until manually reset |
| `disabled` | Key was manually disabled |
| `invalid` | Key returned 401 (unauthorized); removed from rotation until manually reset |

## Best Practices

- Put your most reliable key at priority `0`.
- Add at least one backup key.
- Check the dashboard regularly for `exhausted` or `invalid` keys.
