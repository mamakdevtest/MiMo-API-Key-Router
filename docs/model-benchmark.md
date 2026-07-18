# Model benchmark

The dashboard’s **Benchmark** screen verifies that synchronized chat models can actually complete a request and compares their end-to-end response latency.

## How it works

- Select one provider with at least one active credential.
- The router sends every active chat model a small OpenAI-compatible request: `Reply only: OK`, `max_tokens: 1`, `temperature: 0`.
- Tests run with a chosen concurrency from 1 to 5 (default 3) and a batch size from 10 to 100 models (default 20).
- Results report the public model ID, success or failure, HTTP status, full response latency, and a bounded upstream error message.
- The database keeps one durable **last result** per provider model. A later completed test atomically replaces that result; the application does not keep a benchmark history series.

Enable **Test every eligible model sequentially** to test the full synchronized chat catalog in order. It runs as a background dashboard job with concurrency fixed to one, so it is suitable for large catalogs and displays completed/total progress without relying on one long browser request. It may take several minutes and consumes one low-cost request per eligible model.

When this mode receives HTTP `402` or a recognized insufficient-balance response, it marks the current provider credential `exhausted`, retries the same model with the next active credential, and continues the job. The result table identifies the credential used for each completed model and shows credentials automatically marked exhausted. **Stop test** requests a safe stop: the active upstream request is allowed to finish, then no more models are started. A cancellation before a model's final result is recorded does not overwrite its last saved result.

Successful models are listed first, fastest to slowest. A failure can mean the model is unavailable for the credential, does not support chat completions, has access restrictions, or the upstream timed out.

For generic OpenAI-compatible catalogs, obvious non-chat model families such as embeddings, speech, audio, image, video, reranking, and moderation are excluded after the next model synchronization. Re-sync a provider after upgrading if its existing catalog was created before this filtering was available.

Benchmark traffic is an administrative diagnostic. It does not add entries to normal router request analytics, but each request may consume a small amount of upstream quota. A sequential full-catalog check can mark a credential exhausted only when it receives an insufficient-balance response.

## Persistent health and catalog ordering

Every dashboard surface derives health from the same latest benchmark snapshot. The states, in catalog order, are:

1. **Ready** — a successful result less than 24 hours old.
2. **Rate limited** — Vercel's recognised free-tier response less than 24 hours old; the model is reachable but temporarily limited.
3. **Untested** — no benchmark has been recorded.
4. **Stale** — the latest result is 24 hours old or older.
5. **Failed** — the latest result is a fresh failure.
6. **Inactive** — the provider is disabled or the synchronized model is no longer active.

Within a health group the catalog uses lower measured latency first, then provider priority and model name. The Model Catalog shows health, last latency, HTTP status, and test time; mix search and saved mix targets show the same snapshot. Provider pages and the Dashboard aggregate ready, rate-limited, untested/stale, and failed counts, including a count of models that should be retested.

Health affects only dashboard visibility and ordering. It does **not** remove models from `GET /v1/models`, reject a direct model call, or change normal gateway failover behavior.

## Vercel free-tier limits and mix routes

`Free tier requests on this model are rate-limited.` is treated as a temporarily available Vercel model: the result is successful, its latency cell says **rate limited**, and the key is kept active. During a sequential check, the service tries each active key twice for that model before moving on.

Use **Model Catalog** to select active chat models directly and create an alias such as `vercel.mix.router`. The selected order is the failover order, and you can create any number of aliases. Use the alias as the client `model`. For Vercel's free-tier per-model limit, the gateway tries all active keys twice and then automatically continues with the next model in the mix. Balance failures still exhaust the relevant key.
