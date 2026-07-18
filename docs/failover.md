# Routing and failover

The client selects a public model ID. The router resolves its provider prefix, chooses an eligible credential from that provider's pool, and sends the request through the provider adapter.

## Credential selection

Eligible credentials are selected by ascending priority. Credentials that are disabled, exhausted, invalid, or still cooling down are skipped.

| Upstream outcome | Credential action |
|---|---|
| `401` | Mark invalid |
| `402` | Mark exhausted |
| `403` | Mark disabled |
| `429`, timeout, network error, or `5xx` | Put into cooldown and try another eligible credential |

Cooldown durations and request timeout are configured in the dashboard settings. When all eligible credentials or provider targets fail, the client receives an upstream failure response.

For streamed responses, the router does not retry after response bytes have been forwarded. This avoids duplicate completions and tool calls.
