# Multi-Provider Router — OrcaRouter + Custom Provider Implementasyon Planı

## Context

MiMo-API-Key-Router projesi **zaten multi-provider altyapısına sahip**: `ProviderAdapter` interface, `ProviderRegistry`, `MiMoAdapter`, `FeatherlessAdapter`, `ProviderService`, `RequestOrchestrator` (priority failover + streaming), `RouteResolver` ve `providers`/`provider_credentials`/`provider_models`/`request_attempts` DB tabloları mevcut ve çalışır durumda.

Bu fazda mevcut yapının **üzerine inşa ederek** (sıfırdan yazmadan):
1. **OrcaRouter** provider'ını adapter olarak ekliyoruz
2. **Custom OpenAI-Compatible provider** desteği ekliyoruz (dashboard'dan kod yazmadan ekleme)
3. Gerekli **DB şema genişletmelerini** (documentation URL, custom headers, timeout, health endpoint, `openai_compatible` tipi) yapıyoruz
4. **SSRF güvenlik kontrollerini** ekliyoruz
5. Providers UI'ına **custom provider ekleme formu** ekliyoruz

**Kapsam dışı (sonraki faz):** Route alias + failover-chain yönetimi (madde 7), gelişmiş Overview istatistikleri (madde 5 detay), request-flow ekranı yenileme (madde 8). Mevcut `RouteResolver`'ın provider-prefixed direkt eşleşmesi korunacak.

## Mevcut Mimari (değişmeyecek, referans)

- `backend/src/providers/types.ts` — `ProviderAdapter` interface, `CanonicalRequest`/`CanonicalResponse`, `ProviderCapabilities`. `ProviderType = 'mimo' | 'featherless'` (genişletilecek)
- `backend/src/providers/registry.ts` — `registerAdapter`/`getAdapter`/`getAdapterSafe`
- `backend/src/providers/adapters/mimo.adapter.ts`, `featherless.adapter.ts` — referans implementasyonlar
- `backend/src/providers/provider-service.ts` — provider + credential CRUD, `selectCredential`, `testCredential`
- `backend/src/routing/request-orchestrator.ts` — priority failover, streaming, first-byte sonrası failover engeli, low-credit detection
- `backend/src/routing/route-resolver.ts` — public model ID → provider model çözümleme
- `backend/src/routing/error-classifier.ts` — `classifyHttpError`/`classifyNetworkError` (401→next_credential, 402→exhausted, 429/5xx→cooldown, cold model→next_target)
- `backend/src/db/schema.ts` — `providers` (type enum `'mimo'|'featherless'`), `providerCredentials`, `providerModels`, `requestAttempts`
- `backend/src/routes/admin-providers.ts` — provider CRUD + credentials + sync + model-catalog API'leri
- `frontend/src/pages/Providers.tsx`, `ProviderDetails.tsx`, `ModelCatalog.tsx` — mevcut UI

---

## 1. DB Şema Genişletmesi (migration 0004)

`backend/src/db/schema.ts` + yeni drizzle migration.

### `providers` tablosuna eklenecek kolonlar:
- `documentationUrl` (`text`, nullable) — docs linki (yardımcı bilgi, doğrulama için yeterli değil)
- `authHeader` (`text`, default `'Authorization'`)
- `authPrefix` (`text`, default `'Bearer '`)
- `modelsEndpoint` (`text`, nullable, default `'/models'`)
- `chatCompletionsEndpoint` (`text`, nullable, default `'/chat/completions'`)
- `embeddingsEndpoint` (`text`, nullable)
- `customHeadersJson` (`text`, nullable) — **secret içeren değerler şifreli saklanır**
- `timeoutMs` (`integer`, nullable)
- `healthCheckEndpoint` (`text`, nullable)
- `capabilitiesJson` (`text`, nullable) — otomatik tespit edilen capability profili cache'i

### `providers.type` enum genişletmesi:
`'mimo' | 'featherless'` → `'mimo' | 'featherless' | 'orcarouter' | 'openai_compatible'`

> SQLite enum'ları CHECK constraint olarak drizzle tarafından üretilir. Migration'da tabloyu recreate etmek yerine, drizzle-kit generate ile yeni CHECK üretilecek; mevcut satırlar korunur. Migration 0003'teki gibi `drizzle-kit generate` kullanılacak.

### `provider_credentials` — değişiklik yok (mevcut yapı yeterli).

### `ProviderType` (`types.ts`) güncellemesi:
```ts
export type ProviderType = 'mimo' | 'featherless' | 'orcarouter' | 'openai_compatible';
```

`ProviderInstance` interface'ine yeni alanlar eklenecek ve `provider-service.ts`'teki `mapProvider` mapper'ı güncellenecek.

**Dosyalar:**
- `backend/src/db/schema.ts` (düzenle)
- `backend/drizzle/0004_*.sql` (yeni, `drizzle-kit generate` ile)
- `backend/src/providers/types.ts` (düzenle — `ProviderType`, `ProviderInstance`, `ProviderConfig`)
- `backend/src/providers/provider-service.ts` (düzenle — `mapProvider`, `create`, `update`)

---

## 2. OrcaRouter Adapter

`backend/src/providers/adapters/orcarouter.adapter.ts` (yeni).

`FeatherlessAdapter`'ı referans al (ikisi de OpenAI-compatible). Farklar:

- `readonly type = 'orcarouter'`
- Base URL: `https://api.orcarouter.ai/v1`
- Auth: `Authorization: Bearer <key>` (config'den `authHeader`/`authPrefix` oku, default bu)
- Capabilities:
  ```ts
  {
    supportsChat: true,
    supportsTextCompletion: false,
    supportsEmbeddings: false,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
  }
  ```
- `buildUpstreamRequest`: OpenAI chat completions formatı. Provider-prefixed model ID'leri ve `orcarouter/auto` gibi router/fallback modellerini destekle — **model ID'yi olduğu gibi upstream'e geçir** (OrcaRouter kendi upstream routing'ini yapar; gateway sadece isteği iletir). `body.model = upstreamModelId` (prefix strip edilmeden, OrcaRouter `anthropic/claude-sonnet-4.6` gibi prefixed ID bekler).
- `listModels`: `GET {baseUrl}/models` → OpenAI models listesi formatını `ProviderModelPage`'e map et.
- `getModel`: `GET {baseUrl}/models/{id}` (varsa).
- `testCredential`: `POST /chat/completions` minimal istek (Featherless'teki gibi).
- `classifyError`: mevcut `classifyHttpError`/`classifyNetworkError`'ı kullan.
- `extractUsage`: mevcut `extractTokenUsage` (usage-normalizer) kullan.
- `getPlan`/`getConcurrency`: implemente etme (opsiyonel, OrcaRouter'da yok).

**Structured output (`json_object`/`json_schema`) desteği:** OrcaRouter bunu destekliyor. `CanonicalRequest`'e `responseFormat` alanı ekle ve adapter'da `response_format`'a map et (madde 5'te detay).

**Kayıt:** `backend/src/index.ts` ve `backend/src/test/helpers.ts`'e `registerAdapter(new OrcaRouterAdapter())` ekle.

**Dosyalar:**
- `backend/src/providers/adapters/orcarouter.adapter.ts` (yeni)
- `backend/src/index.ts` (düzenle)
- `backend/src/test/helpers.ts` (düzenle)

---

## 3. Generic OpenAI-Compatible Adapter

`backend/src/providers/adapters/openai-compatible.adapter.ts` (yeni).

Custom provider'lar için generic adapter. Tüm endpoint/auth bilgilerini `provider.configJson` + yeni DB kolonlarından (`authHeader`, `authPrefix`, `modelsEndpoint`, `chatCompletionsEndpoint`, `customHeadersJson`, `timeoutMs`) okur.

- `readonly type = 'openai_compatible'`
- `validateConfig`: baseUrl zorunlu; authHeader/authPrefix default'ları uygula.
- `buildUpstreamRequest`: `{baseUrl}{chatCompletionsEndpoint}` + custom headers + auth header. Body: canonical → OpenAI formatı.
- `listModels`: `{baseUrl}{modelsEndpoint}` → OpenAI formatını parse et. Capability bilinmediğinde muhafazakar default'lar (`supportsChat: true`, diğerleri `false`) — kullanıcı UI'dan düzenleyebilir.
- `testCredential`: chat completions endpoint'ine minimal istek.
- `classifyError`/`extractUsage`: ortak classifier/normalizer kullan.
- Capability'ler instance bazında `capabilitiesJson`'den okunur (adapter'ın statik `capabilities`'i fallback).

**Dosyalar:**
- `backend/src/providers/adapters/openai-compatible.adapter.ts` (yeni)
- `backend/src/index.ts`, `backend/src/test/helpers.ts` (register)

---

## 4. Provider Doğrulama / Auto-Detection Servisi

`backend/src/services/provider-validation-service.ts` (yeni).

Custom provider eklerken "Base URL gir → otomatik doğrula" akışı için. Sırayla:
1. **URL güvenliği** — SSRF kontrolü (madde 6)
2. **`GET {modelsEndpoint}`** test et + auth doğrula (credential varsa)
3. **Model listesi çek** — başarılıysa capability profili oluştur
4. **Streaming testi** — minimal streaming chat isteği (`stream: true`), ilk chunk geliyor mu
5. **Capability profili** — tespit edilenleri `capabilitiesJson`'e yaz

Sonuç: `{ urlSafe, modelsReachable, authValid, modelsCount, streamingWorks, capabilities, errors[], warnings[] }`.

`POST /admin/providers/validate` endpoint'i (madde 5'te). Dokümantasyon linki yalnızca `documentationUrl` olarak saklanır — doğrulama çalışan API config'i üzerinden yapılır (planın 3. maddesindeki gereksinim).

**Dosyalar:**
- `backend/src/services/provider-validation-service.ts` (yeni)

---

## 5. Structured Output (`response_format`) Desteği

OrcaRouter `json_object` ve `json_schema` destekliyor. Canonical modele ekle:

- `types.ts` → `CanonicalRequest`'e:
  ```ts
  responseFormat?: { type: 'text' | 'json_object' } | { type: 'json_schema'; jsonSchema: {...} };
  ```
- `gateway.ts` → `handleChatRequest`'te `body.response_format`'ı `canonical.responseFormat`'a map et.
- `orcarouter.adapter.ts` + `openai-compatible.adapter.ts` → `buildUpstreamRequest`'te `responseFormat`'ı OpenAI `response_format` alanına çevir.

**Dosyalar:** `types.ts`, `gateway.ts`, ilgili adapter'lar.

---

## 6. Güvenlik: SSRF + Secret Koruması

### SSRF kontrolü — `backend/src/security/url-validator.ts` (yeni)
- `validateProviderUrl(url)`:
  - Sadece `https://` (production'da); `http://` yalnızca `NODE_ENV=development`/`test`'te
  - Hostname'i DNS resolve et → IP private/loopback/link-local/reserved ise reddet (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `::1`, `fc00::/7`, vb.)
  - `ALLOW_PRIVATE_PROVIDER_URLS=true` env var ile override edilebilsin (default engelli)
- Provider create/update + validate endpoint'lerinde çağrılır.

### Secret koruması
- `customHeadersJson` içindeki değerler: header adı `authorization`, `x-api-key`, `*-key`, `*-token`, `*-secret` pattern'ine uyuyorsa `encrypt()` (mevcut AES-256-GCM, `crypto/index.ts`) ile şifrelenerek saklanır. Adapter okurken `decrypt()` eder.
- Credential test sonucu yalnızca `maskedSecret` + durum döner (mevcut `testCredential` zaten bunu yapıyor — korunacak).
- Authorization header'ları log'lara yazılmaz (orchestrator'daki mevcut davranış doğrulanacak; hata log'larında header basılmadığından emin olunacak).

### Rate limit
- `/admin/providers/validate` ve `/admin/providers/:id/test` endpoint'lerine sıkı rate limit (Fastify `@fastify/rate-limit` config ile route-level, örn. 10/dk).

**Dosyalar:**
- `backend/src/security/url-validator.ts` (yeni)
- `backend/src/config.ts` (`ALLOW_PRIVATE_PROVIDER_URLS` ekle)
- `admin-providers.ts` (rate limit + SSRF çağrıları)

---

## 7. Backend API Genişletmeleri

`backend/src/routes/admin-providers.ts` (düzenle):

- `createProviderSchema` / `updateProviderSchema` → yeni alanlar (`documentationUrl`, `authHeader`, `authPrefix`, `modelsEndpoint`, `chatCompletionsEndpoint`, `embeddingsEndpoint`, `customHeaders`, `timeoutMs`, `healthCheckEndpoint`, `capabilities`). `type` enum'una `'orcarouter'`, `'openai_compatible'` ekle.
- **Yeni:** `POST /admin/providers/validate` — body `{ baseUrl, authHeader?, authPrefix?, modelsEndpoint?, secret?, customHeaders? }` → `ProviderValidationService.validate()`. Provider kaydetmeden önce "bağlantıyı test et" için.
- Provider create/update'te SSRF kontrolü çağır.
- Custom headers'ı kaydederken secret pattern'lerini şifrele.

Mevcut endpoint'ler (list, get, patch, delete, enable, disable, test, sync-models, credentials/*, models, model-catalog) **değişmeden çalışmaya devam edecek** — yeni tipler (orcarouter, openai_compatible) bunlarla otomatik uyumlu.

---

## 8. Frontend: Custom Provider Ekleme Formu

`frontend/src/pages/Providers.tsx` (düzenle) — mevcut "Create Provider" dialog'unu geliştir:

- **Provider türü seçimi:** MiMo / Featherless / OrcaRouter / Custom OpenAI-Compatible (radio/select)
- **Template preset'leri:** tür seçilince baseUrl, authHeader, endpoint default'ları otomatik dolar (MiMo: `api.xiaomimimo.com/v1`; Featherless: `api.featherless.ai`; OrcaRouter: `api.orcarouter.ai/v1`; Custom: boş)
- **Custom seçildiğinde ek alanlar:** baseUrl, authHeader, authPrefix, modelsEndpoint, chatCompletionsEndpoint, embeddingsEndpoint, customHeaders (key-value editör), timeoutMs, healthCheckEndpoint, documentationUrl, capability checkbox'ları
- **"Test Connection" butonu (inline):** formu kaydetmeden `POST /admin/providers/validate` çağır → sonuçları inline göster (✓ URL güvenli, ✓ modeller erişilebilir, ✓ auth geçerli, ✓ streaming çalışıyor / ✗ hatalar). 6 adımlı wizard yerine tek form + inline test adımları (kullanıcı tercihi).
- Test başarılıysa "Create + Sync Models" butonu aktif → create + `sync-models`.

`frontend/src/lib/api.ts` → `providers` objesine `validate()` metodu + create/update'e yeni alanlar.

`frontend/src/pages/ProviderDetails.tsx` → yeni alanları (documentation URL, endpoints, custom headers, capabilities) Configuration sekmesinde göster/düzenle. Mevcut credential yönetimi değişmez.

**Dosyalar:**
- `frontend/src/pages/Providers.tsx` (düzenle)
- `frontend/src/pages/ProviderDetails.tsx` (düzenle)
- `frontend/src/lib/api.ts` (düzenle)

---

## 9. Testler

`backend/src/test/` (mevcut vitest setup'ı, `:memory:` SQLite):

- `orcarouter-adapter.test.ts` — validateConfig, buildUpstreamRequest (model ID passthrough, auth header), classifyError, extractUsage
- `openai-compatible-adapter.test.ts` — config'den endpoint/auth okuma, custom headers, capability default'ları
- `url-validator.test.ts` — SSRF: private/loopback IP reddi, https zorunluluğu, dev override
- `provider-validation-service.test.ts` — doğrulama akışı (mock fetch ile models/streaming/capability tespiti)
- `admin-providers.test.ts` — create custom provider (yeni alanlar), validate endpoint, SSRF reddi, custom headers şifreleme
- `migration.test.ts` — 0004 migration sonrası mevcut provider satırlarının korunduğunu, yeni kolonların default değerlerini doğrula
- Mevcut testlerin (`failover.test.ts`, `proxy.test.ts`, `key-router.test.ts`, `auth.test.ts`) geçmeye devam ettiğini doğrula

`helpers.ts`'e OrcaRouter + openai_compatible adapter kayıtları eklenecek.

---

## 10. Doğrulama (end-to-end)

1. `cd backend && npx drizzle-kit generate` → migration 0004 üret
2. `cd backend && npm run typecheck`
3. `cd backend && npm test` (tüm unit + migration + failover + streaming testleri)
4. `cd frontend && npm run build`
5. `cd backend && npm run build`
6. Docker build doğrula
7. Manuel akış: dashboard → Add Provider → OrcaRouter (baseUrl `https://api.orcarouter.ai/v1`) → credential ekle → Test → Sync Models → model-catalog'da OrcaRouter modelleri görünür → `POST /v1/chat/completions` `model: "orcarouter/<model>"` ile istek → provider-prefixed çözümleme + failover çalışır
8. Custom provider: Add Provider → Custom → baseUrl gir → Test Connection (inline sonuçlar) → Create+Sync

---

## Tamamlama Görevleri (bu faz)

- [ ] Migration 0004: providers tablosu genişletme + type enum (`orcarouter`, `openai_compatible`)
- [ ] `ProviderType` + `ProviderInstance` + `provider-service` mapper güncelleme
- [ ] `OrcaRouterAdapter` (model ID passthrough, `orcarouter/auto` desteği)
- [ ] `OpenAICompatibleAdapter` (generic, config-driven)
- [ ] `ProviderValidationService` (SSRF → models → auth → streaming → capability)
- [ ] `CanonicalRequest.responseFormat` + `json_object`/`json_schema` mapping
- [ ] `url-validator.ts` (SSRF) + `ALLOW_PRIVATE_PROVIDER_URLS` config
- [ ] Custom headers secret şifreleme
- [ ] `POST /admin/providers/validate` endpoint + rate limit
- [ ] Providers.tsx custom provider formu + inline test
- [ ] ProviderDetails.tsx yeni alanlar
- [ ] api.ts güncellemeleri
- [ ] Adapter, url-validator, validation-service, admin-providers, migration testleri
- [ ] typecheck + test + frontend build + backend build + Docker build doğrulama

## Sonraki Faz (kapsam dışı)

- Route alias + failover-chain yönetimi (model_routes CRUD API + Routes sayfası + RouteResolver DB-alias çözümleme)
- Gelişmiş Overview istatistikleri (failover oranı, maliyet, latency grafikleri)
- Request-flow ekranı yenileme (canlı Client→Gateway→Route→Provider→Credential→Model akışı)
- Provider logo/görsel kimlik
