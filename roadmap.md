MiMo API Key Router’ı Multi-Provider AI Gateway’e Dönüştür

Sen bu projede çalışan kıdemli bir backend, platform ve frontend mühendisisin.

Mevcut MiMo API Key Router projesini baştan yazmadan, mevcut production özelliklerini ve geriye dönük uyumluluğunu koruyarak provider-bağımsız, genişletilebilir bir Multi-Provider AI Gateway sistemine dönüştür.

İlk desteklenecek provider’lar:

Xiaomi MiMo
Featherless.ai

Ancak oluşturacağın mimari gelecekte OpenRouter, DeepInfra, Together AI, Fireworks, Anthropic, OpenAI ve benzeri provider’ların yeni adapter sınıfları eklenerek sisteme dahil edilebilmesini sağlamalıdır.

Featherless için resmi dokümanları kaynak kabul et:

https://featherless.ai/docs/

Özellikle şu konuları incele:

Quickstart
API overview
/v1/models
/v1/models/{model-id}
/v1/plan
/v1/chat/completions
/v1/completions
/v1/tokenize
/v1/embeddings
Error codes
Tool calling
Vision
Chat template kwargs
Concurrent unit limits
/account/concurrency
/account/concurrency/stream
Request pricing and credits

Dokümantasyonda bulunmayan endpoint veya response alanlarını uydurma.

Temel çalışma kuralı

Önce mevcut repository’yi ayrıntılı olarak analiz et:

Backend klasörleri
Veritabanı şeması ve migration sistemi
Proxy route’ları
KeyRouter
Streaming mantığı
Usage ve cost hesaplaması
Admin API
Frontend sayfaları
React Query kullanımı
SSE sistemi
Testler
Docker ve deployment dosyaları

Analizden sonra docs/multi-provider-architecture.md dosyasını oluştur.

Ancak yalnızca plan hazırlayıp durma. Aynı çalışma içerisinde implementasyona devam et ve sistemi tamamla.

Mevcut çalışan özellikleri bozacak kontrolsüz bir yeniden yazım yapma. Küçük, doğrulanabilir ve geriye uyumlu aşamalarla ilerle.

1. Proje kimliği ve isimlendirme

UI üzerinde kullanılan ürün adını provider-bağımsız hale getir.

Varsayılan ürün adı:

AI Provider Router

Bunu environment variable ile değiştirilebilir yap:

APP_NAME=AI Provider Router

Repository, npm package ve Docker image isimlerini zorunlu olmadıkça hemen değiştirme. Mevcut deployment’ları bozma.

Kod içerisinde yeni oluşturulan sınıflarda, tablolarda ve bileşenlerde mimo kelimesini genel sistem adı olarak kullanma.

Örneğin:

Yanlış:

MimoKeyRouter
MimoRequestLog
MimoProviderService

Doğru:

CredentialRouter
ProviderRegistry
RequestOrchestrator
ProviderAdapter

MiMo yalnızca bir provider adapter’ı olmalıdır.

2. Hedef mimari

Sistemi şu katmanlara ayır:

Client
  ↓
Ingress Protocol Adapter
  ↓
Canonical Internal Request
  ↓
Model Route Resolver
  ↓
Provider Target Selection
  ↓
Credential Selection
  ↓
Provider Adapter
  ↓
Upstream Provider
  ↓
Canonical Internal Response
  ↓
Client Protocol Response

İki farklı kavramı birbirinden kesin olarak ayır:

Ingress protocol

İstemcinin gateway ile konuştuğu protokol:

OpenAI
Anthropic
Upstream provider

İsteğin gönderildiği gerçek servis:

MiMo
Featherless
Gelecekte eklenecek diğer provider’lar

Bir provider’ın yalnızca OpenAI API desteklemesi, Anthropic istemcilerinin onu kullanamayacağı anlamına gelmemelidir.

Örneğin Claude Code’dan gelen /v1/messages isteği:

Anthropic request
→ canonical request
→ Featherless OpenAI chat completion
→ canonical response
→ Anthropic response

şeklinde çevrilebilmelidir.

3. Backend klasör yapısı

Mevcut yapıyı mümkün olduğunca koruyarak aşağıdakine benzer modüler bir yapı oluştur:

backend/src/
├── providers/
│   ├── types.ts
│   ├── registry.ts
│   ├── base-adapter.ts
│   ├── provider-service.ts
│   └── adapters/
│       ├── mimo.adapter.ts
│       └── featherless.adapter.ts
├── protocols/
│   ├── canonical.ts
│   ├── openai/
│   │   ├── request-adapter.ts
│   │   ├── response-adapter.ts
│   │   └── stream-adapter.ts
│   └── anthropic/
│       ├── request-adapter.ts
│       ├── response-adapter.ts
│       └── stream-adapter.ts
├── routing/
│   ├── route-resolver.ts
│   ├── request-orchestrator.ts
│   ├── credential-selector.ts
│   ├── retry-policy.ts
│   └── error-classifier.ts
├── usage/
│   ├── usage-normalizer.ts
│   ├── pricing-service.ts
│   └── token-service.ts
├── services/
│   ├── model-sync-service.ts
│   ├── provider-health-service.ts
│   ├── concurrency-monitor.ts
│   └── stream-manager.ts
└── routes/
    ├── gateway.ts
    ├── admin-providers.ts
    ├── admin-routes.ts
    ├── admin-models.ts
    └── admin-analytics.ts

Dosya isimlerini mevcut proje yapısına göre uyarlayabilirsin, ancak katmanların sorumlulukları birbirine karışmamalıdır.

4. Provider adapter sözleşmesi

Tüm provider’ların uygulayacağı güçlü ve type-safe bir adapter interface oluştur.

Örnek tasarım:

export interface ProviderAdapter {
  readonly type: ProviderType
  readonly capabilities: ProviderCapabilities

  validateConfig(config: ProviderConfig): Promise<ValidationResult>

  testCredential(
    provider: ProviderInstance,
    credential: DecryptedProviderCredential
  ): Promise<CredentialTestResult>

  buildUpstreamRequest(
    context: ProviderRequestContext
  ): Promise<UpstreamRequest>

  parseNonStreamingResponse(
    context: ProviderResponseContext
  ): Promise<CanonicalResponse>

  transformStreamChunk?(
    context: StreamChunkContext
  ): Promise<CanonicalStreamEvent[]>

  classifyError(
    context: ProviderErrorContext
  ): Promise<ClassifiedProviderError>

  extractUsage(
    context: UsageExtractionContext
  ): Promise<NormalizedUsage | null>

  listModels?(
    context: ProviderModelListContext
  ): Promise<ProviderModelPage>

  getModel?(
    context: ProviderModelDetailContext
  ): Promise<ProviderModelDetail>

  getPlan?(
    context: ProviderPlanContext
  ): Promise<ProviderPlanSnapshot>

  getConcurrency?(
    context: ProviderConcurrencyContext
  ): Promise<ProviderConcurrencySnapshot>
}

Provider adapter:

Gateway authentication yapmamalı.
Admin session yönetmemeli.
Global routing kararı vermemeli.
Provider’a özel request, response, model, usage ve hata davranışlarını yönetmeli.
Gerçek API key’i hiçbir zaman frontend’e döndürmemeli.
Secret değerleri loglamamalı.
5. Provider instance ve credential ayrımı

Provider türü ile provider instance’ı farklı kavramlar olmalıdır.

Örnek:

Provider type: featherless
Provider instance: Featherless Main Account

Provider type: featherless
Provider instance: Featherless Backup Account

Her provider instance kendi:

Base URL
API credential havuzu
Routing priority
Health durumu
Plan bilgisi
Concurrency durumu
Model kataloğu
Provider-specific config
Billing mode

bilgilerine sahip olmalıdır.

Böylece farklı Featherless hesapları ayrı provider instance olarak eklenebilir.

6. Veritabanı tasarımı

Mevcut SQLite + Drizzle ORM yapısını koru.

En az aşağıdaki tabloları oluştur veya mevcut tabloları buna göre genişlet:

providers

Önerilen alanlar:

id
type
name
slug
base_url
enabled
priority
routing_weight
health_status
health_message
config_json
billing_mode
last_health_check_at
created_at
updated_at

type başlangıçta:

type ProviderType = 'mimo' | 'featherless'

Provider sistemi yeni adapter eklenmesine uygun olmalıdır.

provider_credentials
id
provider_id
name
encrypted_secret
masked_secret
priority
status
cooldown_until
failure_count
success_count
last_used_at
last_success_at
last_error_at
last_error_code
last_error_message
created_at
updated_at

Credential durumları:

type CredentialStatus =
  | 'active'
  | 'cooldown'
  | 'exhausted'
  | 'invalid'
  | 'disabled'
provider_models
id
provider_id
upstream_model_id
display_name
model_class
status
availability_tier
context_length
effective_context_length
max_completion_tokens
concurrency_cost
is_gated
available_on_current_plan
supports_chat
supports_text_completion
supports_tools
supports_vision
supports_embeddings
input_modalities_json
output_modalities_json
tasks_json
features_json
pricing_prompt
pricing_completion
pricing_image
pricing_request
metadata_json
last_synced_at
created_at
updated_at

Fiyat alanlarında JavaScript floating-point işlemi kullanma.

Fiyatları decimal string olarak sakla ve hesaplamalarda decimal.js benzeri güvenilir bir decimal kütüphanesi kullan.

model_routes

Gateway’in dışarıya sunduğu model alias’larını temsil etsin:

id
public_model_id
display_name
description
route_kind
strategy
enabled
is_public
allowed_protocols_json
required_capabilities_json
created_at
updated_at

Örnek public model ID’leri:

coding-pro
general-fast
reasoning-large
mimo-v2.5-pro

route_kind:

type RouteKind =
  | 'chat'
  | 'text_completion'
  | 'embedding'
model_route_targets
id
route_id
provider_id
provider_model_id
priority
weight
enabled
timeout_override_ms
max_attempts_override
created_at
updated_at

Bir route birden fazla target içerebilmeli:

coding-pro
  1. MiMo → mimo-v2.5-pro
  2. Featherless → Qwen/Qwen3-Coder-...
request_attempts

Tek gateway isteğinde yapılan her upstream denemesini ayrı kaydet:

id
request_log_id
attempt_number
route_id
route_target_id
provider_id
credential_id
upstream_model_id
started_at
completed_at
latency_ms
http_status
result
error_scope
error_code
error_message
retryable
response_started
Mevcut tablolar

Şunları koru ve yeni sisteme adapte et:

request_logs
provider_events veya mevcut api_key_events
settings
admin_sessions
gateway_credentials

request_logs tablosuna şunları ekle:

ingress_protocol
route_id
public_model_id
final_provider_id
final_credential_id
upstream_model_id
attempt_count
failover_count
input_tokens
output_tokens
cached_tokens
estimated_cost
billing_mode
streaming
7. Güvenli ve geriye uyumlu migration

Migration sırasında mevcut MiMo kullanıcı verilerini kaybetme.

Migration şu işlemleri yapmalı:

Varsayılan bir MiMo provider instance oluştur:
type: mimo
slug: mimo
name: Xiaomi MiMo
Mevcut api_keys kayıtlarını provider_credentials tablosuna taşı.
Mevcut request log kayıtlarını MiMo provider ile ilişkilendir.
Mevcut public model ayarlarını model_routes ve model_route_targets kayıtlarına dönüştür.
Mevcut gateway anahtarlarını, admin hesaplarını ve session sistemini koru.
Legacy MiMo environment variable’larını en az bir geçiş sürümü boyunca destekle.
Migration işlemini transaction içerisinde gerçekleştir.
Destructive migration yapma. Eski tabloları hemen silme.
Migration tekrar çalıştırıldığında duplicate provider, credential veya route oluşturmamalı.
Migration öncesi SQLite yedekleme mekanizması ekle veya güvenli bir backup komutu oluştur.

Örnek:

npm run db:backup
npm run db:migrate
8. Canonical request ve response modeli

OpenAI ile Anthropic formatları arasında kontrollü dönüşüm yapabilmek için internal canonical modeller oluştur.

Desteklenmesi gereken içerikler:

System message
User message
Assistant message
Text content
Image URL
Base64 image
Tool definitions
Tool choice
Tool call
Tool result
Stop sequences
Temperature
Top-p
Max output tokens
Streaming
Reasoning/thinking configuration
Usage
Finish reason

Provider’ın desteklemediği bir özellik sessizce kaldırılmamalı.

Bunun yerine:

Route validation sırasında uyarı göster.
İstek sırasında açıklayıcı 400 veya 422 gateway hatası dön.
Hangi target’ın hangi capability’yi desteklemediğini logla.
Alternatif target aynı capability’yi destekliyorsa ona failover yap.
9. Model routing sistemi

Varsayılan routing strategy:

priority_failover

Ayrıca veri modeli ileride şunlara uygun olsun:

weighted_round_robin
least_concurrency
lowest_cost

Ancak ilk implementasyonda yalnızca gerçekten tamamlanan stratejileri UI’da aktif göster.

Route resolution akışı:

Gelen model alanını çöz.
Public route bul.
İstek capability gereksinimlerini çıkar.
Uyumlu route target’larını filtrele.
Priority sırasına koy.
Provider sağlık ve capacity durumunu kontrol et.
Credential seç.
Upstream isteğini gönder.
Retry veya failover kararını provider error classifier üzerinden ver.
Başarılı response’u client protokolüne çevir.

Legacy MiMo model ID’leri çalışmaya devam etmelidir.

Örneğin mevcut istemci şu modeli kullanıyorsa:

mimo-v2.5-pro

migration sonrasında da değişiklik yapmadan çalışmalıdır.

10. Retry ve failover modeli

Error handling işlemini yalnızca HTTP status koduna bağlama.

Her hata şu yapıya normalize edilmeli:

interface ClassifiedProviderError {
  category: string
  scope: 'request' | 'credential' | 'model' | 'provider'
  retryable: boolean
  action:
    | 'fail_client'
    | 'retry_same_target'
    | 'next_credential'
    | 'next_target'
  cooldownMs?: number
  publicMessage: string
  internalMessage?: string
}

Global maksimum attempt sayısı ayarlanabilir olsun:

MAX_UPSTREAM_ATTEMPTS=10

Exponential backoff ve jitter kullan.

Ancak uzun süreli provider/model problemlerinde gateway request’ini dakikalarca açık tutma.

Streaming güvenlik kuralı

Client’a herhangi bir response byte’ı veya SSE event’i gönderildikten sonra:

Başka credential’a geçme.
Başka provider’a geçme.
Aynı isteği yeniden başlatma.
Tool call’u tekrar üretmeye çalışma.

Bu kural Claude Code’da çift tool execution oluşmasını engellemek için kesinlikle korunmalıdır.

response_started durumu request attempt seviyesinde takip edilmelidir.

11. MiMo adapter

Mevcut MiMo davranışlarını yeni adapter içine taşı.

Şunları koru:

OpenAI upstream desteği
Anthropic upstream desteği
SSE pass-through
402 exhausted
401 invalid
403 disabled
429 cooldown
Timeout ve 5xx retry
Low-credit body detection
OpenAI ve Anthropic usage extraction
Cache token çıkarma
MiMo fiyatlandırması
Mevcut model ID’leri
Mevcut header allowlist davranışı

MiMo adapter’a taşınan davranışın regression testlerini oluştur.

12. Featherless adapter

Yeni bir FeatherlessProviderAdapter oluştur.

Varsayılan yapılandırma:

Base URL: https://api.featherless.ai/v1
Authentication: Authorization: Bearer <API_KEY>

Ayrıca provider config üzerinden şu client attribution header’larını destekle:

HTTP-Referer
X-Title

Varsayılan X-Title değeri uygulama adı olabilir.

Gerçek API key frontend’e veya loglara gönderilmemelidir.

Desteklenecek upstream endpoint’ler
POST /v1/chat/completions
POST /v1/completions
POST /v1/embeddings
POST /v1/tokenize
GET  /v1/models
GET  /v1/models/{model-id}
GET  /v1/plan
GET  /account/concurrency
GET  /account/concurrency/stream

/account/concurrency endpoint’i /v1 altında değildir. URL oluşturma sırasında bunu dikkate al. String replace ile kırılgan URL üretme; URL sınıfını kullan.

13. Featherless model senkronizasyonu

Featherless model kataloğunu yalnızca statik bir model listesi olarak ele alma.

GET /v1/models için:

Server-side pagination kullan.
per_page sınırını dikkate al.
Model arama ve filtrelerini backend üzerinden destekle.
Authentication varsa available_on_current_plan bilgisini al.
Binlerce modeli tek response ile frontend’e göndermeye çalışma.

Desteklenecek filtreler:

Search
Family
Model class
Status
Capability
Modality
Context length
Gated
Current plan availability
Popularity
Language
Task

Model detayları gerektiğinde:

GET /v1/models/{model-id}

ile alınmalı.

Model ID’lerinin / içerdiğini dikkate al. URL path encoding işlemini doğru yap.

Model detayından mümkünse şu alanları sakla:

Model ID
Context length
Max completion tokens
Model class
Concurrency cost
Gated durumu
Current plan availability
Deployment status
Warm/loading/cold/offline durumu
Tool-use özelliği
Vision özelliği
Input/output modalities
Tasks
Parameter size
MoE bilgisi
License
Dynamic pricing

Model listesi periyodik olarak yenilenebilmeli.

Şunları ekle:

“Sync Models” admin aksiyonu
Son sync tarihi
Sync sonucu
Eklenen model sayısı
Güncellenen model sayısı
Artık bulunamayan model sayısı
Sync hata mesajı

Provider detay ekranında manuel sync butonu bulunmalı.

Otomatik sync ayarlanabilir olmalı. Varsayılan olarak makul bir aralık kullan; çok sık binlerce model çekme.

14. Featherless plan ve concurrency desteği

Provider credential testinden sonra mümkünse:

GET /v1/plan

çağrısı yap.

Aşağıdaki bilgileri provider seviyesinde göster:

Plan ID
Plan adı
Plan context limiti
Maksimum model büyüklüğü
Toplam concurrency unit limiti
Son güncelleme tarihi

Bir modelin effective context limitini şu şekilde hesapla:

min(model.context_length, plan.max_context_length)

Plan context limiti null ise modelin kendi context limitini kullan.

Canlı concurrency

Backend içerisinde Featherless concurrency durumunu takip eden bir servis oluştur.

Tercihen tek bir upstream SSE bağlantısını backend yönetsin:

GET /account/concurrency/stream

Her dashboard kullanıcısı için Featherless’e ayrı SSE bağlantısı açma.

Backend bu veriyi mevcut internal StreamManager üzerinden admin dashboard’a yayınlasın.

Takip edilecek alanlar:

Limit
Used cost
Available units
Request count
In-flight model
Request unit cost
Started time
Duration

SSE bağlantısı koparsa:

Exponential reconnect uygula.
Provider credential değişirse bağlantıyı yenile.
Provider kapatılırsa bağlantıyı kapat.
Secret değerleri event payload’una koyma.

Snapshot gerektiğinde:

GET /account/concurrency

kullan.

15. Featherless hata sınıflandırması

Featherless hatalarını MiMo hata mantığıyla aynı şekilde değerlendirme.

400

İki farklı durum olabilir:

Client validation hatası
Retry yapma.
Client’a açıklayıcı hata dön.
Model cold veya not ready
Credential’ı invalid veya cooldown yapma.
Hatayı model seviyesinde işaretle.
Model availability durumunu cold veya loading olarak güncelle.
Alternatif route target varsa ona geç.
Alternatif yoksa gateway’den açıklayıcı bir 503 dön.
Dakikalar sürebilecek kontrolsüz retry yapma.
401
Credential invalid olarak işaretlenebilir.
Aynı provider’daki sonraki credential denenebilir.
Sonra alternatif route target’a geçilebilir.
403

Bu hata gated model veya plan erişimi problemi olabilir.

Credential’ı invalid/disabled yapma.
Error response body’sini güvenli biçimde incele.
Modeli gated, plan_unavailable veya forbidden olarak işaretle.
Alternatif target’a geç.
UI’da model sayfasına gidilmesi veya plan erişimi gerektiğini belirt.
404
Model ID güncelliğini yitirmiş olabilir.
Model target’ını stale/not-found olarak işaretle.
Alternatif target’a geç.
Model sync önerisi oluştur.
429

Featherless’te bu durum concurrency unit limitinin dolması olabilir.

Credential’ı otomatik olarak invalid veya exhausted yapma.
Provider seviyesinde capacity_limited durumu oluştur.
Retry-After varsa dikkate al.
Kısa bounded retry uygulanabilir.
Alternatif provider target varsa ona geç.
Aynı Featherless account altındaki başka key’e geçmenin concurrency problemini çözmeyebileceğini dikkate al.
500
Provider/server seviyesinde retryable hata olarak değerlendir.
Bounded retry uygula.
Sonrasında alternatif target’a geç.
503
Insufficient model capacity olarak değerlendir.
Aynı request’i kısa backoff ile en fazla üç defa deneyebilirsin.
Ardından alternatif provider/model target’a geç.
Credential’ı invalid yapma.
Credit veya balance problemi

Response body veya status açıkça balance/credit yetersizliğini gösteriyorsa:

Provider veya credential’ı exhausted olarak işaretle.
Alternatif credential/provider’a geç.
Belirsiz bir hata mesajından balance sonucu çıkarma.
16. Featherless billing ve cost sistemi

Featherless farklı billing modlarında kullanılabileceğinden provider instance’a şu alanı ekle:

type BillingMode =
  | 'subscription'
  | 'per_request'
  | 'unknown'

Admin provider formunda billing mode seçilebilsin.

per_request

Model detayından gelen pricing alanlarıyla:

Input cost
Output cost
Image cost
Request cost

hesaplanabilsin.

subscription
Token kullanımı yine takip edilsin.
Tahmini token değeri ayrı gösterilebilir.
Gerçek maliyet kesinmiş gibi gösterilmesin.
UI’da “Included in subscription” veya “Cost not directly metered” göster.
unknown
Token bilgisi göster.
Cost alanını N/A göster.
Admin’e billing mode seçme uyarısı ver.

Dokümante edilmemiş bir balance endpoint’i uydurma.

17. OpenAI gateway endpoint’leri

Aşağıdaki gateway endpoint’lerini destekle:

GET  /health
GET  /v1/models
POST /v1/chat/completions
POST /v1/completions
POST /v1/embeddings
POST /v1/tokenize

/v1/models tüm Featherless kataloğunu public olarak döndürmemelidir.

Yalnızca:

Public route’lar
Admin tarafından açıkça publish edilmiş direct provider modelleri

gösterilmelidir.

Response OpenAI models formatıyla uyumlu olmalıdır.

18. Anthropic ve Claude Code desteği

Mevcut:

POST /v1/messages

desteğini koru.

Featherless yalnızca OpenAI-compatible upstream kullandığı için Anthropic ↔ OpenAI çeviri katmanı oluştur.

En az şu özellikleri destekle:

System prompt
User/assistant messages
Text blocks
Tools
Tool use
Tool result
Stop reason
Max tokens
Temperature
Streaming
Usage
Request ID

Anthropic tool tanımlarını OpenAI tool/function formatına çevir.

OpenAI tool call response’unu Anthropic tool_use content block’una çevir.

Anthropic tool_result içeriğini OpenAI tool message formatına dönüştür.

Streaming sırasında uygun Anthropic event sırasını üret:

message_start
content_block_start
content_block_delta
content_block_stop
message_delta
message_stop

Streaming translator için state machine kullan. Basit string replacement yapma.

Bir Featherless modelinin tool-use desteği yoksa:

Route oluşturma ekranında uyar.
Claude Code compatibility badge’ini gösterme.
Tool içeren request’te bu target’ı atla.
Uyumlu alternatif target yoksa açıklayıcı hata dön.
19. Tool, vision, embeddings ve reasoning özellikleri

Model capability’lerini route seviyesinde doğrula.

Tools

Model detail içindeki tool-use/capability bilgisini kullan.

Provider modeli tool calling desteklemiyorsa sessizce tools alanını silme.

Vision

Vision-capable Featherless modellerinde OpenAI image content formatını destekle:

Public image URL
Base64 data URL
Multiple images

Route target vision desteklemiyorsa alternatif target ara.

Embeddings

Embedding route’larını chat route’larından ayrı tut.

POST /v1/embeddings yalnızca embedding capability’si olan modelleri kullanmalı.

Reasoning

Featherless için chat_template_kwargs alanını destekle.

Özellikle:

{
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}

gibi model-specific değerleri kontrollü biçimde pass-through et.

Anthropic request’ten reasoning ayarı çevrilemiyorsa bunu açıkça dokümante et; uydurma eşleme yapma.

20. Provider health sistemi

Her provider için aşağıdaki health durumlarını kullan:

type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'capacity_limited'
  | 'unavailable'
  | 'disabled'
  | 'unknown'

Provider health yalnızca tek bir credential hatasıyla unavailable olmamalı.

Health hesabında şunları dikkate al:

Aktif credential sayısı
Son başarılı istek zamanı
Son hata oranı
Timeout oranı
Provider plan bilgisi
Capacity/concurrency kullanımı
Model availability
Upstream health check sonucu

Admin dashboard’da provider health nedenini açıklayan tooltip veya detay alanı göster.

21. Admin API

Aşağıdaki provider-bağımsız admin endpoint’lerini oluştur:

GET    /admin/providers
POST   /admin/providers
GET    /admin/providers/:id
PATCH  /admin/providers/:id
DELETE /admin/providers/:id

POST   /admin/providers/:id/test
POST   /admin/providers/:id/enable
POST   /admin/providers/:id/disable
POST   /admin/providers/:id/sync-models

GET    /admin/providers/:id/credentials
POST   /admin/providers/:id/credentials
PATCH  /admin/providers/:id/credentials/:credentialId
DELETE /admin/providers/:id/credentials/:credentialId

POST   /admin/providers/:id/credentials/:credentialId/test
POST   /admin/providers/:id/credentials/:credentialId/reset
POST   /admin/providers/:id/credentials/:credentialId/enable
POST   /admin/providers/:id/credentials/:credentialId/disable

GET    /admin/providers/:id/models
GET    /admin/providers/:id/plan
GET    /admin/providers/:id/concurrency
GET    /admin/providers/:id/events

GET    /admin/routes
POST   /admin/routes
GET    /admin/routes/:id
PATCH  /admin/routes/:id
DELETE /admin/routes/:id
POST   /admin/routes/:id/test
POST   /admin/routes/:id/enable
POST   /admin/routes/:id/disable

GET    /admin/model-catalog
GET    /admin/requests
GET    /admin/request-attempts/:requestId

Mevcut /admin/keys endpoint’lerini bir geçiş sürümü boyunca MiMo provider’a yönlendiren compatibility layer ile koru.

Admin validation işlemlerinde Zod kullan.

22. Frontend bilgi mimarisi

Sidebar’ı şu şekilde güncelle:

Overview
Providers
Model Catalog
Routes
Gateway Keys
Requests
Settings
Documentation

Eski Keys sayfasını doğrudan kaldırmak yerine:

Provider credentials sistemine taşı.
Gerekirse eski route için redirect oluştur.
Kullanıcının mevcut bookmark’larını bozma.
23. Overview dashboard

Dashboard artık global multi-provider görünümü sunmalıdır.

Üst özet kartları
Enabled Providers
Healthy Providers
Active Credentials
Requests — 24h
Success Rate
Failover Rate
Input Tokens
Output Tokens
Estimated Cost
Active Concurrency

Cost kartı billing mode’lara göre doğru ifade kullanmalı.

Provider status alanı

Her provider için kompakt kart göster:

Provider adı ve türü
Health
Aktif credential sayısı
Son request
Son latency
24 saat başarı oranı
Current concurrency
Plan veya billing mode
Hızlı provider detay bağlantısı
Grafikler
Requests by Provider
Requests by Public Model
Requests by Upstream Model
Success/Failure over Time
Token Usage by Provider
Estimated Cost by Provider
Failover Reasons
Latency by Provider
Error Category Distribution

Grafiklerde provider, model ve zaman filtresi bulunmalı.

24. Live Request Flow tasarımı

Mevcut canlı flow diagram’ını şu akışa genişlet:

Client
→ Gateway
→ Public Route
→ Provider
→ Credential
→ Upstream Model
→ Response

Her request için attempt timeline göster:

Attempt 1
MiMo / Credential 1 / mimo-v2.5-pro
429 → cooldown

Attempt 2
Featherless / Main Key / Qwen model
200 → streaming

Gösterilecek alanlar:

Gateway request ID
Ingress protocol
Public model
Selected provider
Selected credential mask
Upstream model
Attempt count
Failover reason
Status
Latency
Tokens
Cost
Streaming state
Error scope

Credential’ın gerçek secret değeri hiçbir zaman gösterilmemeli.

Animasyon gösterişli fakat okunabilir olmalı. Framer Motion kullanabilirsin ancak performansı bozma.

25. Providers sayfası

Providers sayfasında provider instance kartları göster.

Her kartta:

Provider icon veya lettermark
Provider name
Provider type
Base URL domain
Enabled/disabled
Health
Credential count
Active model count
Last successful request
24h success rate
Current concurrency
Routing priority
“Manage” butonu

Üst alanda:

Add Provider
Provider type filter
Health filter
Search
Refresh Health
Add Provider wizard

Adım 1:

Provider type seçimi

Adım 2:

Name
Base URL
Billing mode
Priority
Provider-specific settings

Adım 3:

İlk credential
Credential name
Secret
Test connection

Adım 4:

Plan ve capability özeti
Save

Featherless seçildiğinde base URL otomatik dolsun.

26. Provider detail sayfası

Provider detayını tab’lere ayır:

Overview
Credentials
Models
Limits & Plan
Events
Configuration
Overview
Health
Request totals
Success rate
Failover rate
Latency
Token usage
Cost
Son hatalar
Son başarılı istek
Credentials
Masked key
Priority
Status
Last used
Last success
Failure count
Cooldown countdown
Test
Reset
Enable/disable
Delete
Bulk add
Models
Search
Availability filter
Capability filter
Plan availability
Context length
Gated
Public route count
Last sync
Sync Models
Limits & Plan

Featherless için:

Plan name
Max context
Max model size
Concurrency limit
Used units
Available units
Live request count
In-flight requests
Events
Credential failures
Provider health changes
Model sync
Concurrency saturation
Credential state changes
Route failovers
27. Model Catalog sayfası

Tek bir birleşik model kataloğu oluştur.

Tablo sütunları:

Provider
Model ID
Display name
Family/class
Status
Availability
Plan access
Context
Max output
Tool use
Vision
Embeddings
Concurrency cost
Input price
Output price
Route count
Last synced

Filtreler:

Provider
Search
Capability
Modality
Warm/loading/cold
Available on plan
Gated
Context range
Model family
Route status

Binlerce model için:

Server-side pagination
Debounced search
URL-synced filters
Table virtualization
Loading skeleton
Empty state
Error retry state

Tüm modelleri browser memory’sine yükleme.

Model detail drawer veya sayfasında:

Full metadata
Pricing
Availability
Plan eligibility
Capabilities
Context
Parameter size
License
Existing routes
“Add to Route”
“Create Route from Model”
“Test Model”

aksiyonları olsun.

28. Routes sayfası

Model routing sistemini görsel ve anlaşılır hale getir.

Her route kartı veya satırı:

Public model ID
Route kind
Enabled
Public/private
Allowed protocols
Target count
Primary provider
Fallback providers
24h requests
Success rate
Failover rate
Route editor

Alanlar:

Public model ID
Display name
Description
Route kind
Public toggle
Allowed protocols
Required capabilities
Routing strategy
Max total attempts

Targets bölümü drag-and-drop priority desteklesin.

Her target:

Provider
Upstream model
Priority
Weight
Enabled
Context
Tool support
Vision support
Availability
Plan access
Estimated pricing
Concurrency cost

Route validation şunları kontrol etsin:

Duplicate target
Disabled provider
Invalid provider model
Model plan üzerinde kullanılamıyor
Gated model
Route kind uyuşmazlığı
Anthropic/Claude Code için tool support
Vision uyuşmazlığı
Embedding uyuşmazlığı
Effective context farkları
Tüm target’ların unavailable olması

“Test Route” aksiyonu gerçek gateway routing pipeline’ını kullanmalı ve attempt sonucunu göstermelidir.

29. Requests ve log detayları

Requests sayfasını provider-aware hale getir.

Sütunlar:

Time
Request ID
Protocol
Public model
Final provider
Upstream model
Status
Attempts
Failovers
Input tokens
Output tokens
Cost
Latency
Streaming

Request detay drawer’ında:

Sanitized request metadata
Final response metadata
Attempt timeline
Provider error classification
Credential mask
Retry reason
Failover reason
Token breakdown
Cost breakdown
Stream start time
Total latency

Prompt ve completion içeriklerini varsayılan olarak loglama.

Mevcut privacy davranışını koru.

30. UI/UX görsel dili

Mevcut koyu, minimal ve teknik dashboard stilini koru; ancak multi-provider ölçeğine uygun hale getir.

Kurallar:

Provider’ları yalnızca renkle ayırma; icon, text ve badge de kullan.
Status renklerinin yanında metin göster.
Mobil ve tablet responsive tasarım ekle.
Tables için sticky header kullan.
Kritik aksiyonlarda confirmation dialog kullan.
Secret input alanlarında show/hide kontrolü olsun.
Credential oluşturulduktan sonra secret yeniden gösterilmesin.
Loading, empty, error ve degraded state’leri eksiksiz tasarla.
Klavye navigasyonunu ve erişilebilirliği koru.
Tooltip’lerle provider-specific kavramları açıkla.
Binlerce model bulunan sayfalarda render performansını koru.
UI içinde “MiMo Keys” gibi provider’a özel global başlıklar kullanma.
31. Settings sayfası

Settings sayfasını bölümlere ayır:

Gateway
Routing
Security
Retry & Timeouts
Logging
Data & Backup
Appearance
Gateway
Public base URL
Gateway key rotation
Temporary keys
Routing
Default routing strategy
Maximum attempts
Default provider timeout
Failover enabled
Provider health threshold
Security
IP allowlist
Rate limits
Session settings
CSRF
Trusted proxies
Retry & Timeouts

Provider-specific override desteği ekle.

Logging
Retention
Log level
Prompt logging disabled uyarısı
Request metadata retention
Data & Backup
Backup database
Restore documentation
Database size
Log cleanup
32. Güvenlik gereksinimleri

Mevcut güvenlik özelliklerini koru:

AES-256-GCM secret encryption
Argon2id hashing
httpOnly admin cookie
CSRF protection
IP allowlist
Rate limiting
Helmet CSP
Non-root Docker
Secure secret masking

Ek gereksinimler:

Provider config JSON içine plaintext API key koyma.
API key yalnızca encrypted credential alanında saklansın.
Error body loglanırken secret ve authorization header redaction uygula.
Request/response header allowlist kullan.
Client’ın gönderdiği Authorization header’ını upstream’e olduğu gibi iletme.
Her upstream request’te seçilen provider credential’ını kontrollü biçimde ekle.
SSRF riskine karşı custom base URL validation ekle.
Localhost/private network base URL kullanımını admin setting ile açıkça kontrol et.
Provider test endpoint’lerinde rate limit uygula.
API key test sonucu secret içermesin.
33. Usage ve analytics

Tüm provider usage formatlarını normalize et:

interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  cacheCreationTokens?: number
  imageUnits?: number
}

Non-streaming Featherless response’larında OpenAI usage alanını kullan.

Streaming response usage içermiyorsa:

Uydurma token üretme.
Provider tokenize endpoint’i güvenilir ve uygulanabilir ise kontrollü post-processing kullan.
Bu işlem client response’unu geciktirmemeli.
Token değeri bulunamıyorsa unknown olarak sakla.

Cost hesaplamasında:

Provider
Billing mode
Model pricing
Input/output tokens
Request pricing
Image pricing

bilgilerini dikkate al.

Cost kaynak bilgisini sakla:

type CostSource =
  | 'provider_dynamic_pricing'
  | 'manual_override'
  | 'static_catalog'
  | 'subscription'
  | 'unknown'
34. Dokümantasyon

Mevcut docs sistemini multi-provider hale getir.

Aşağıdaki dokümanları oluştur veya güncelle:

docs/architecture.md
docs/providers.md
docs/providers/mimo.md
docs/providers/featherless.md
docs/model-routing.md
docs/failover.md
docs/client-configuration.md
docs/claude-code.md
docs/open-webui.md
docs/security.md
docs/backup-restore.md
docs/troubleshooting.md
docs/migration-from-mimo-router.md

Featherless dokümanında şunları açıkla:

Provider oluşturma
API key ekleme
Model sync
Plan bilgisi
Concurrency meter
Model route oluşturma
Cold/loading model davranışı
Gated model davranışı
429 concurrency davranışı
Claude Code için tool-capable model seçimi
Open WebUI kurulumu
Billing mode seçimi

İç dashboard Documentation sayfasını da güncelle.

35. Client configuration örnekleri
OpenAI-compatible client

Gateway örneği:

OPENAI_BASE_URL=https://your-gateway.example.com/v1
OPENAI_API_KEY=<GATEWAY_API_KEY>

Model:

coding-pro
Open WebUI
OpenAI Base URL:
https://your-gateway.example.com/v1

API Key:
<GATEWAY_API_KEY>
Claude Code

Mevcut Anthropic-compatible gateway config yöntemini koru:

ANTHROPIC_BASE_URL=https://your-gateway.example.com
ANTHROPIC_AUTH_TOKEN=<GATEWAY_API_KEY>
ANTHROPIC_MODEL=coding-pro

Claude Code route’unun tool-use destekleyen modellerden oluşması gerektiğini dokümante et.

36. Test stratejisi

Gerçek Featherless API key’i test suite için zorunlu olmasın.

Node MockAgent, Vitest mock server veya mevcut test altyapısını kullan.

Unit testler
MiMo adapter request oluşturma
Featherless adapter request oluşturma
Authorization header
Model URL encoding
Usage extraction
Dynamic pricing
Decimal cost calculation
Error classification
Route resolution
Credential selection
Capability validation
Anthropic/OpenAI dönüşümü
Streaming event dönüşümü
Migration testleri
Eski MiMo database fixture
Provider oluşturulması
Key migration
Public model migration
Log migration
Idempotent migration
Veri kaybı olmaması
Failover testleri
MiMo 429 → sonraki credential
MiMo 402 → exhausted
Featherless 401 → sonraki credential
Featherless 400 cold → alternatif target
Featherless 403 gated → credential korunur
Featherless 429 concurrency → provider capacity-limited
Featherless 503 → üç bounded retry → fallback
Provider timeout → fallback
Tüm target’lar başarısız → normalized 503
Streaming testleri
İlk byte öncesi failover
İlk byte sonrası failover yapılmaması
Stream disconnect
Anthropic SSE event sırası
Tool call streaming
Usage extraction
Client abort propagation
Frontend testleri
Provider create form
Credential masking
Model server-side pagination
Route validation
Provider filter
Concurrency display
Error/empty/loading states
37. Gözlemlenebilirlik

Structured Pino loglarına şu alanları ekle:

requestId
attemptId
providerId
providerType
credentialId
routeId
publicModel
upstreamModel
ingressProtocol
attemptNumber
errorScope
errorCategory
latencyMs

API key, authorization header, prompt veya completion loglama.

Metrics için en az internal analytics seviyesinde şunları takip et:

Requests by provider
Attempts by provider
Failover count
Provider errors
Credential errors
Model cold errors
Concurrency rejections
Latency percentiles
Token usage
Estimated cost
38. Docker ve deployment

Mevcut single-container deployment yaklaşımını koru.

Multi-stage Docker build bozulmamalı.
SQLite /data volume korunmalı.
Healthcheck provider erişimine bağlı olmamalı; uygulama çalışıyorsa /health cevap verebilmeli.
Provider health ayrı bir alan olarak raporlanmalı.
Existing Coolify deployment çalışmaya devam etmeli.
Environment variable dokümantasyonu güncellenmeli.
Container non-root user ile çalışmalı.

DATABASE_URL varsayılan adını hemen değiştirmek mevcut volume’ları bozacaksa eski değerle uyumlu kal.

39. Git çalışma düzeni

Çalışmaya başlamadan önce mevcut git durumunu kontrol et.

Kullanıcının mevcut değişikliklerini silme veya overwrite etme.

Mantıklı aşamalarda commit oluştur:

refactor: introduce provider domain and registry
feat: migrate mimo integration to provider adapter
feat: add featherless provider adapter
feat: add model catalog and synchronization
feat: add model routing and multi-provider failover
feat: add featherless plan and concurrency monitoring
feat: redesign admin dashboard for providers and routes
test: add multi-provider routing and migration coverage
docs: document providers routing and migration

Her commit build edilebilir durumda olmalıdır.

40. Tamamlama kriterleri

Görev yalnızca aşağıdaki kriterlerin tamamı karşılandığında bitmiş kabul edilir:

Mevcut MiMo istemcileri değişiklik yapmadan çalışıyor.
Eski MiMo API key’leri migration ile korunuyor.
Dashboard’dan Featherless provider eklenebiliyor.
Featherless API key şifreli saklanıyor.
Credential connection test çalışıyor.
Featherless modelleri server-side pagination ile listeleniyor.
Model detayları ve dynamic pricing senkronize ediliyor.
Featherless plan bilgisi gösteriliyor.
Featherless concurrency kullanımı gösteriliyor.
Public model route oluşturulabiliyor.
Bir route içinde MiMo ve Featherless fallback target olarak kullanılabiliyor.
OpenAI /v1/chat/completions çalışıyor.
OpenAI /v1/completions çalışıyor.
Desteklenen modeller için /v1/embeddings çalışıyor.
Anthropic /v1/messages Featherless target’a çevrilebiliyor.
Claude Code tool calls desteklenen modelde çalışıyor.
Streaming başladıktan sonra retry/failover yapılmıyor.
Provider-specific hatalar doğru scope ile sınıflandırılıyor.
Featherless 403 hatası API key’i invalid yapmıyor.
Featherless 429 hatası provider concurrency problemi olarak gösteriliyor.
Request attempt geçmişi dashboard’da görülebiliyor.
Cost hesaplaması billing mode’u dikkate alıyor.
Binlerce model frontend performansını bozmuyor.
Secret değerleri API response veya loglarda görünmüyor.
TypeScript typecheck başarılı.
Lint başarılı.
Testler başarılı.
Production build başarılı.
Docker build başarılı.
Dokümantasyon güncel.
41. Final doğrulama

Implementasyon tamamlandıktan sonra sırayla çalıştır:

npm run typecheck
npm run lint
npm test
npm run build
docker build .

Bulduğun hataları düzeltmeden görevi tamamlanmış sayma.

Son raporda şunları açıkla:

Yapılan mimari değişiklikler
Oluşturulan migration’lar
Eklenen tablolar
Eklenen backend endpoint’leri
Eklenen frontend panelleri
Featherless entegrasyon davranışı
MiMo geriye uyumluluğu
Çalıştırılan testler
Build sonuçları
Bilinen sınırlamalar
Manuel test adımları
Oluşturulan git commit’leri

Sadece mock UI oluşturma. Backend, database, routing, provider adapter, streaming, analytics ve frontend özelliklerini birlikte çalışan gerçek bir sistem olarak tamamla.