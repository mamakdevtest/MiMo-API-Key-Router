# 05 - Failover and Key States

MiMo API Key Router routes every request to the highest-priority available MiMo key. If that key fails, it tries the next one.

## Selection Order

1. Start from the key with the lowest `priority` number (0 is highest).
2. Skip keys that are `exhausted`, `invalid`, `disabled`, or in `cooldown`.
3. Use the first available key.

## What Happens When a Key Fails?

| Upstream Response | Router Action |
|-------------------|---------------|
| 402 Payment Required | Mark key `exhausted`; remove from rotation until manual reset |
| 429 Too Many Requests | Mark key `cooldown` for configured seconds; try next key |
| 401 Unauthorized | Mark key `invalid`; remove from rotation until manual reset |
| 403 Forbidden | Mark key `disabled`; remove from rotation until manual reset |
| 5xx Server Error | Mark key `cooldown` temporarily; try next key |
| Network Error / Timeout | Mark key `cooldown` temporarily; try next key |

## Cooldown Behavior

When a key enters `cooldown`, it is skipped for the configured duration. After the cooldown expires, the key automatically returns to `active` status at its original priority.

Default cooldown durations:

- 429 cooldown: 60 seconds
- 5xx cooldown: 60 seconds
- Timeout cooldown: 60 seconds

You can change these in **Settings**.

## Streaming Safety

Once a streaming response has started sending bytes to the client, the router **will not** fall back to another key. This prevents duplicate tool executions and inconsistent agent behavior in Claude Code.

Fallback only happens before the upstream response begins.

## No Round-Robin

The router does **not** distribute requests evenly. It always tries the highest-priority working key first. This gives you predictable behavior and full control over which key is primary.
