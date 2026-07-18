# 04 - Client Configuration

This guide shows how to connect popular AI clients to MiMo API Key Router.

You need your **gateway API key** (printed on first server startup) and your router URL.

## Router URLs

| Environment | Base URL |
|-------------|----------|
| Local dev | `http://localhost:4000` |
| Production | `https://api.ai.emirhanmamak.com` |

## Claude Code

Set these environment variables before running Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://api.ai.emirhanmamak.com
export ANTHROPIC_AUTH_TOKEN=mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export ANTHROPIC_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=mimo-v2.5
```

Then start Claude Code normally.

## Open WebUI

1. Open Open WebUI settings.
2. Add a new OpenAI API connection.
3. Use these values:

```text
OpenAI Base URL: https://api.ai.emirhanmamak.com/v1
API Key: mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

4. Save and refresh the model list.
5. Select `mimo-v2.5` or `mimo-v2.5-pro`.

## Generic OpenAI Client

```text
Base URL: https://api.ai.emirhanmamak.com/v1
API Key: mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Supported endpoints:

- `GET /v1/models`
- `POST /v1/chat/completions` (streaming and non-streaming)

Example request:

```bash
curl https://api.ai.emirhanmamak.com/v1/chat/completions \
  -H "Authorization: Bearer mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mimo-v2.5-pro",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Generic Anthropic Client

```text
Base URL: https://api.ai.emirhanmamak.com
API Key: mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Supported endpoints:

- `GET /v1/models`
- `POST /v1/messages` (streaming and non-streaming)

Example request:

```bash
curl https://api.ai.emirhanmamak.com/v1/messages \
  -H "Authorization: Bearer mimo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "mimo-v2.5-pro",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Notes

- Only the two chat models (`mimo-v2.5`, `mimo-v2.5-pro`) are visible in `/v1/models` by default.
- Audio models can still be used by sending the exact MiMo model ID in the request body.
