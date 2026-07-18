# Client configuration

Use the router key (`GATEWAY_KEY` or an active temporary router key), never an upstream provider credential. Find valid model IDs from `GET /v1/models`.

## OpenAI-compatible clients

```text
Base URL: https://router.example.com/v1
API key: YOUR_GATEWAY_KEY
Model: provider-slug/upstream-model-id
```

```bash
curl https://router.example.com/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_GATEWAY_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"provider-slug/upstream-model-id","messages":[{"role":"user","content":"Hello"}]}'
```

## Anthropic-compatible clients

```text
Base URL: https://router.example.com
API key: YOUR_GATEWAY_KEY
Model: provider-slug/upstream-model-id
```

The router accepts `POST /v1/messages` and translates the request for the selected upstream provider where supported.

## Claude Code

Set the endpoint, token, and a public model ID in the environment used to start Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://router.example.com
export ANTHROPIC_AUTH_TOKEN=YOUR_GATEWAY_KEY
export ANTHROPIC_MODEL=provider-slug/upstream-model-id
```

The exact model names depend on your synchronized catalog. Do not use old unprefixed model IDs.
