# MiMo API Key Router — Proje Analiz Dokümanı

> Bu doküman, **MiMo API Key Router** projesinin ne işe yaradığını, neler yaptığını ve hangi teknolojileri kullandığını parça parça açıklayan kapsamlı bir analizdir.

---

## 1. Proje Ne İşe Yarar? (Özet)

**MiMo API Key Router**, Xiaomi MiMo yapay zeka API'sine erişimi yöneten, **production-ready (üretime hazır) bir API gateway'dir**.

Çok sayıda "pay-as-you-go" (kullandıkça öde) MiMo API anahtarını bir havuzda (pool) toplar ve istemcilere **tek bir gateway API anahtarı** sunar. Böylece:

- Gerçek MiMo API anahtarları hiçbir zaman istemcilere (Claude Code, Open WebUI vb.) açığa çıkmaz.
- Bir anahtar biterse, kısıtlanırsa veya hata verirse otomatik olarak sıradaki anahtara geçilir (failover).
- Tüm trafik tek bir kontrollü noktadan geçer; maliyet, token kullanımı ve loglar izlenir.

### Kullanım Senaryosu
```
[Claude Code / Open WebUI] → [MiMo API Key Router (gateway)] → [MiMo API - Birden fazla anahtar]
        tek anahtar                    anahtar havuzu + failover              xiaomimimo.com
```

---

## 2. Temel Özellikler

| Özellik | Açıklama |
|--------|----------|
| **Tek Gateway Anahtarı** | Tüm istemciler tek bir anahtar kullanır; gerçek MiMo anahtarları gizli kalır |
| **Şifreli Depolama** | MiMo anahtarları AES-256-GCM ile şifrelenir |
| **Sıralı Failover** | Anahtarlar öncelik sırasına göre denenir; cooldown/exhausted/invalid/disabled durumları |
| **Anthropic uyumlu** | `/v1/messages` ve `/v1/models` uç noktaları (Claude Code ile uyumlu) |
| **OpenAI uyumlu** | `/v1/chat/completions`, `/v1/models`, `/health` (Open WebUI ile uyumlu) |
| **Admin Dashboard** | Koyu temalı, minimal yönetim arayüzü |
| **IP Allowlist** | CIDR desteği ile IPv4/IPv6 IP kısıtlama |
| **Streaming (SSE)** | Akışlı yanıtlar için Server-Sent Events pass-through |
| **SQLite + WAL** | Tek dosya veritabanı, WAL modu ile performans |
| **Tek Docker Konteyneri** | docker-compose ile kolay dağıtım |

---

## 3. Teknoloji Yığını (Tech Stack)

### Backend
- **Dil:** TypeScript
- **Web Framework:** Fastify 5 (yüksek performanslı Node.js framework'ü)
- **Veritabanı:** SQLite (better-sqlite3) + **Drizzle ORM**
- **Kriptografi:**
  - **AES-256-GCM** — MiMo API anahtarlarını şifrelemek için (PBKDF2 ile anahtar türetme)
  - **Argon2id** — Admin parolası ve gateway anahtarı hashing için
- **HTTP İstemcisi:** Node.js native `fetch` (undici)
- **Validasyon:** Zod (ortam değişkenleri ve istek gövdeleri)
- **Güvenlik:** Helmet (CSP), CORS, Cookie, Rate Limiting eklentileri
- **Logging:** Pino + pino-pretty
- **Test:** Vitest

### Frontend
- **Framework:** React 18
- **Build Tool:** Vite 6
- **Stil:** Tailwind CSS 3 + shadcn/ui (Radix UI bileşenleri)
- **Veri Çekme:** TanStack React Query
- **Grafikler:** Recharts (bar, pie, line chart)
- **Animasyon:** Framer Motion
- **İkonlar:** lucide-react
- **Routing:** React Router DOM 7
- **Form Validasyon:** Zod

### Deployment
- **Docker:** Multi-stage build (node:20-alpine)
- **Coolify** desteği (PaaS self-hosted deployment)
- **GitHub Actions** ile Docker image build pipeline

### Workspace Yapısı (Monorepo)
```
MiMo-API-Key-Router/
├── shared/      → Backend ve frontend arasında paylaşılan tipler (TypeScript)
├── backend/     → Fastify API sunucusu
├── frontend/    → React admin dashboard
└── package.json → Workspace orchestrasyonu
```

---

## 4. Mimari Yapı

### 4.1 Backend Mimarisi

```
backend/src/
├── index.ts              → Sunucu başlangıcı, eklenti kayıtları
├── config.ts             → Zod ile ortam değişkeni doğrulama
├── crypto/index.ts       → AES-256-GCM şifreleme + Argon2id hashing
├── db/
│   ├── index.ts          → SQLite + Drizzle bağlantısı
│   ├── schema.ts         → Veritabanı şeması (tablo tanımları)
│   ├── migrate.ts        → Migration çalıştırıcı
│   └── drizzle/          → SQL migration dosyaları
├── auth/index.ts         → Gateway anahtarı doğrulama + Admin session + IP allowlist
├── routes/
│   ├── proxy.ts          → Ana proxy mantığı (failover, streaming, token/cost)
│   └── admin.ts          → Admin API (CRUD keys, settings, logs, usage analytics)
└── services/
    ├── key-router.ts     → Anahtar seçimi ve durum yönetimi
    ├── stream-manager.ts → SSE ile canlı olay yayını
    ├── request-logger.ts → İstek loglama
    └── setup.ts          → İlk kurulum (admin parolası, gateway anahtarı)
```

#### Sunucu Başlangıcı (`index.ts`)
- Fastify instance oluşturulur (Pino logger, trustProxy ayarı)
- Veritabanı bağlanır, migration'lar çalıştırılır
- Admin kurulumu yapılır (`setupAdmin`)
- Eklentiler sırayla kaydedilir: CORS → Helmet → Cookie → Rate Limit
- Auth, Proxy ve Admin route'ları kaydedilir
- Frontend dist statik olarak servis edilir (SPA fallback dahil)
- Hata yakalama ve 404 handler tanımlanır

#### Konfigürasyon (`config.ts`)
- Tüm ortam değişkenleri **Zod** şeması ile doğrulanır
- Geçersiz değişken varsa sunucu başlamaz (`process.exit(1)`)
- Varsayılan değerler tanımlı (port 4000, SQLite yolu vb.)

---

### 4.2 Veritabanı Şeması (`db/schema.ts`)

6 ana tablo:

| Tablo | Amacı |
|-------|-------|
| `api_keys` | MiMo API anahtarları (şifrelenmiş, masked, öncelik, durum, hata bilgisi) |
| `api_key_events` | Anahtar olay geçmişi (failover, hata kayıtları) |
| `settings` | Tek satır ayar (cooldown süreleri, IP allowlist, public modeller, hash'ler) |
| `admin_sessions` | Admin oturum token'ları (httpOnly cookie) |
| `gateway_credentials` | Geçici/süreli gateway anahtarları (temp keys) |
| `request_logs` | Tüm istek logları (token, cost, latency, streaming bilgisi) |

**Anahtar Durumları:** `active` → `cooldown` → `exhausted` / `invalid` / `disabled`

---

### 4.3 Kriptografi (`crypto/index.ts`)

- **`encrypt/decrypt`** — AES-256-GCM algoritması:
  - Her şifreleme için rastgele IV (16 byte) ve salt (32 byte)
  - PBKDF2 ile 100.000 iterasyonla anahtar türetme (SHA-256)
  - Auth tag ile bütünlük koruması
- **`hashPassword/verifyPassword`** — Argon2id (memoryCost: 64MB, timeCost: 3, parallelism: 4)
- **`hashGatewayKey/verifyGatewayKey`** — Gateway anahtarları için Argon2id
- **`maskKey`** — Anahtarı maskeleme (ilk 3, son 4 karakter görünür)
- **`generateSecureToken`** — Güvenli rastgeel token üretimi

---

### 4.4 Anahtar Yönlendirme (`services/key-router.ts`)

`KeyRouter` sınıfı anahtar seçim ve durum yönetimini yapar:

- **`selectKey(excludeKeyIds)`**:
  - Önce süresi dolan cooldown anahtarlarını otomatik aktif eder
  - Öncelik sırasına (priority ASC) göre sıralar
  - Daha önce denenmiş anahtarları atlar (`excludeKeyIds`)
  - Kalıcı olarak kullanılamaz (exhausted/invalid/disabled) anahtarları atlar
  - Hala cooldown'da olanları atlar (güvenlik ağı)
  - Seçilen anahtarın şifresini çözer ve döndürür

- **`markKeyState`** — Anahtar durumunu günceller + olay kaydı ekler (transaction içinde)
- **`getCooldownDuration`** — HTTP durum koduna göre cooldown süresi belirler (429, 5xx, timeout için ayrı)
- **`recordUsage`** — Son kullanım zamanını günceller

---

### 4.5 Proxy Mantığı (`routes/proxy.ts`)

Bu, projenin **kalbi**. `proxyRequest` fonksiyonu:

1. **İstek başlatılır** — `request_started` olayı yayınlanır (bir kez)
2. **Retry döngüsü** (max 10 deneme):
   - `selectKey` ile sıradaki anahtar seçilir
   - Anahtar yoksa → `503 Service Unavailable`
   - `key_selected` olayı yayınlanır
   - Upstream'e istek gönderilir (timeout ile AbortController)
   - HTTP durum koduna göre failover kararları:

| Upstream Durum | Yapılan İşlem |
|----------------|---------------|
| **200** | Başarı → yanıt stream/buffer olarak geri gönderilir |
| **402** | Anahtar `exhausted` işaretlenir, sıradaki denenir |
| **429** | Anahtar `cooldown` (ayarlanan süre), sıradaki denenir |
| **401** | Anahtar `invalid`, sıradaki denenir |
| **403** | Anahtar `disabled`, sıradaki denenir |
| **5xx / timeout / ağ hatası** | Geçici `cooldown`, sıradaki denenir |
| **Tüm anahtarlar başarısız** | `503` döner |

3. **Streaming güvenliği:** Akış yanıtı başladıktan sonra **retry/fallback yapılmaz** (tasarım gereği — Claude Code'da çift tool execution engellenir)
4. **Low-credit tespiti:** 200 dönerse bile yanıt gövdesinde "insufficient balance" gibi kalıplar aranır, bulunursa exhausted işaretlenir
5. **Token & Cost hesaplama:**
   - OpenAI (`prompt_tokens`/`completion_tokens`) ve Anthropic (`input_tokens`/`output_tokens`) formatları desteklenir
   - Cache token'ları da çıkarılır (Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`)
   - Model bazlı fiyatlandırma ile maliyet hesaplanır (8 ondalık basamak hassasiyet)
6. **Streaming token çıkarma:** SSE chunk'larından son 5 chunk buffer'lanıp usage verisi çıkarılır

#### Route'lar
| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/health` | GET | Sağlık kontrolü |
| `/v1/models` | GET | Public modelleri listeler (OpenAI formatı) |
| `/v1/chat/completions` | POST | OpenAI uyumlu proxy |
| `/v1/messages` | POST | Anthropic uyumlu proxy |

#### Fiyatlandırma (model başına 1M token)
| Model | Input | Output |
|-------|-------|--------|
| mimo-v2.5-pro | $0.435 | $0.87 |
| mimo-v2.5 | $0.14 | $0.28 |
| mimo-v2.5-asr | $0.074 | - |
| mimo-v2.5-tts* | Ücretsiz (sınırlı süre) | - |

---

### 4.6 Auth & Güvenlik (`auth/index.ts`)

**İki katmanlı kimlik doğrulama:**

#### Katman 1 — Gateway Anahtarı (API istemcileri için)
- `/v1/*` yolları için `onRequest` hook
- `Authorization: Bearer <gateway_key>` doğrulanır (Argon2id)
- Önce ana gateway anahtarı denenir, sonra **geçici anahtarlar** (temp keys)
- Geçici anahtarlarda **süre dolması** ve **istek limiti** kontrol edilir
- **IP Allowlist:** CIDR desteği ile IPv4/IPv6 (kendi buffer karşılaştırma implementasyonu)

#### Katman 2 — Admin Session (Dashboard için)
- `/admin/*` yolları için ayrı `onRequest` hook
- httpOnly cookie ile oturum (`admin_session`)
- **CSRF koruması:** Session token = CSRF token (state-changing isteklerde `X-CSRF-Token` header kontrolü)
- Login rate limit: 5 deneme / 5 dakika

#### Diğer Güvenlik Önlemleri
- Helmet ile CSP, güvenlik header'ları
- Global rate limit: 200 istek/dakika/IP
- Anthropic header allowlist (sadece `anthropic-*` ve `x-claude-code-*` header'ları iletilir)

---

### 4.7 Admin API (`routes/admin.ts`)

Tam bir yönetim API'si:

**Dashboard & Analytics:**
- `GET /admin/dashboard` — Özet istatistikler (aktif/cooldown/exhausted anahtar sayısı, 24s başarı oranı)
- `GET /admin/usage?period=` — Kullanım analizi (modele göre, anahtara göre, saatlik, toplamlar)

**Anahtar Yönetimi (CRUD):**
- `GET/POST /admin/keys` — Listele, tekli/bulk oluştur
- `GET/PATCH/DELETE /admin/keys/:id` — Detay, güncelle, sil
- `POST /admin/keys/:id/enable|disable|reset|move` — Durum ve sıralama kontrolü
  - `move up/down` ile öncelik değiştirme (swap mantığı)
  - Yeni anahtar eklenince diğerlerinin priority değeri otomatik kayar

**Ayarlar:**
- `GET/PATCH /admin/settings` — Cooldown süreleri, timeout, IP allowlist, public modeller
- `GET /admin/models` — Model listesi + public durumu
- `POST /admin/rotate-gateway-key` — Gateway anahtarı rotasyonu (eski anında geçersiz)
- `POST /admin/change-password` — Admin parolası değiştirme

**Loglar:**
- `GET /admin/logs?limit=&offset=` — İstek logları (paginate)

**Geçici Anahtarlar:**
- `GET/POST /admin/temp-keys` — Süreli/limitli anahtar oluştur (`mimo_temp_` prefix)
- `DELETE /admin/temp-keys/:id` — Sil
- `POST /admin/temp-keys/:id/revoke|reactivate` — İptal/yeniden aktif et

**Canlı Akış:**
- `GET /admin/stream` — SSE ile gerçek zamanlı olay yayını

---

### 4.8 Canlı Akış Yönetimi (`services/stream-manager.ts`)

`StreamManager` sınıfı:
- Bağlı dashboard istemcilerini (`Set<FastifyReply>`) tutar
- 15 saniyede bir keep-alive ping gönderir
- `broadcast(event)` ile tüm istemcilere olay yayar
- İstek kapanınca otomatik temizlik

**Olay Tipleri:** `request_started`, `key_selected`, `upstream_sent`, `upstream_response`, `streaming_started`, `streaming_completed`, `key_failed`, `failover_attempted`, `request_completed`

---

### 4.9 Frontend Mimarisi

```
frontend/src/
├── main.tsx                    → React giriş noktası
├── App.tsx                     → Router + Auth guard + SSE listener
├── index.css                   → Tailwind + global stiller
├── lib/
│   ├── api.ts                  → Tüm API çağrıları (fetch wrapper, CSRF, 401 yönetimi)
│   └── utils.ts                → Yardımcı fonksiyonlar (cn vb.)
├── hooks/
│   ├── useAuth.ts              → Kimlik doğrulama durumu
│   └── use-toast.ts            → Bildirim sistemi
├── components/
│   ├── Layout.tsx              → Sidebar + navigasyon
│   ├── LiveFlowDiagram.tsx     → Canlı istek akış diyagramı (SSE + Framer Motion)
│   └── ui/                     → shadcn/ui bileşenleri (button, card, dialog, input vb.)
└── pages/
    ├── Login.tsx               → Admin giriş
    ├── Dashboard.tsx           → Özet + grafikler + canlı diyagram
    ├── Keys.tsx                → Anahtar yönetimi
    ├── TempKeys.tsx            → Geçici anahtar yönetimi
    ├── Settings.tsx            → Ayarlar
    ├── Logs.tsx                → İstek logları
    └── Docs.tsx                → Dahili dokümantasyon
```

#### Önemli Frontend Özellikleri:
- **Auth Guard:** `App.tsx` kimlik doğrulanmamışsa Login'e yönlendirir
- **SSE Listener:** `request_completed` olayında dashboard/usage/logs/keys query'leri invalidate edilir (otomatik yenileme)
- **CSRF:** Her istekte `X-CSRF-Token` header'ı (cookie'den okunur)
- **401 yönetimi:** Yetkisiz yanıtta otomatik login'e yönlendirme
- **Canlı Diyagram (`LiveFlowDiagram`):** Client → Router → Key → Upstream akışını görselleştirir, gerçek zamanlı olay timeline'ı, token/cost gösterimi, animasyonlu durum göstergeleri
- **Grafikler:** Requests by Model (Bar), Token Distribution (Pie), Requests Over Time (Line), detay tabloları

---

## 5. Deployment

### Dockerfile (Multi-stage)
1. **Stage 1 (deps):** Tüm bağımlılıklar (dev dahil, `npm ci --include=dev`)
2. **Stage 2 (builder):** `shared → frontend → backend` sırasıyla build, sonra dev bağımlılıklar prunelanır
3. **Stage 3 (runner):** Minimal production image
   - `node:20-alpine` tabanı
   - Non-root user (`router:nodejs`, UID 1001)
   - Sadece production artifact'ları kopyalanır
   - Healthcheck (`healthcheck.sh` ile `/health`)
   - `/data` volume persistent veri için

### docker-compose.yaml
- GHCR image (`ghcr.io/mamakdevtest/mimo-api-key-router:latest`)
- Port 4000, `/data` volume
- Healthcheck (30s aralık, 3 retry)
- `restart: unless-stopped`

### CI/CD
- `.github/workflows/docker-build.yml` — GitHub Actions ile otomatik Docker image build ve push

### Coolify
- `COOLIFY.md` ve `docs/coolify-deployment.md` ile detaylı deployment rehberi
- HTTPS termination + reverse proxy (port 4000)

---

## 6. Ortam Değişkenleri

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `INITIAL_ADMIN_PASSWORD` | İlk başlatma | Admin dashboard parolası |
| `APP_ENCRYPTION_KEY` | Hayır | 32+ karakter, MiMo anahtar şifreleme (varsayılan fallback var) |
| `SESSION_SECRET` | Hayır | Session cookie imzalama (varsayılan rastgele) |
| `PORT` | Hayır | Sunucu portu (varsayılan 4000) |
| `DATABASE_URL` | Hayır | SQLite yolu (varsayılan `file:/data/mimo-router.sqlite`) |
| `TRUST_PROXY` | Hayır | Reverse proxy'den `X-Forwarded-For` (varsayılan false) |
| `COOKIE_SECURE` | Hayır | Secure cookie (HTTPS için true) |
| `LOG_LEVEL` | Hayır | Pino log seviyesi (varsayılan info) |
| `SESSION_MAX_AGE_SECONDS` | Hayır | Oturum ömrü (varsayılan 86400) |
| `MIMO_OPENAI_BASE_URL` | Hayır | Varsayılan `https://api.xiaomimimo.com/v1` |
| `MIMO_ANTHROPIC_BASE_URL` | Hayır | Varsayılan `https://api.xiaomimimo.com/anthropic` |
| `MIMO_AUTH_HEADER` | Hayır | Auth header adı (varsayılan `Authorization`) |
| `MIMO_AUTH_PREFIX` | Hayır | Auth prefix (varsayılan `Bearer `) |

---

## 7. Desteklenen Modeller

| Model ID | Açıklama | Varsayılan Public |
|----------|----------|-------------------|
| `mimo-v2.5` | Genel sohbet modeli | ✅ |
| `mimo-v2.5-pro` | Gelişmiş sohbet modeli | ✅ |
| `mimo-v2.5-asr` | Konuşma tanıma | ❌ |
| `mimo-v2.5-tts` | Metin-konuşma | ❌ |
| `mimo-v2.5-tts-voiceclone` | Ses klonlama | ❌ |
| `mimo-v2.5-tts-voicedesign` | Ses tasarımı | ❌ |

Private modeller dashboard'dan etkinleştirilebilir, model ID ile doğrudan erişilebilir.

---

## 8. İstemci Yapılandırması

### Claude Code (Anthropic uyumlu)
```bash
export ANTHROPIC_BASE_URL=https://api.ai.emirhanmamak.com
export ANTHROPIC_AUTH_TOKEN=<GATEWAY_API_KEY>
export ANTHROPIC_MODEL=mimo-v2.5-pro
```
Veya `.claude/settings.json` ile proje bazlı.

### Open WebUI (OpenAI uyumlu)
```
OpenAI Base URL: https://api.ai.emirhanmamak.com/v1
API Key: <GATEWAY_API_KEY>
```

---

## 9. Güvenlik Özeti

| Katman | Yöntem |
|--------|--------|
| MiMo anahtar depolama | AES-256-GCM + PBKDF2 (100k iterasyon) |
| Gateway/admin anahtar hashing | Argon2id (memoryCost 64MB) |
| Admin oturum | httpOnly, secure, sameSite=lax cookie |
| CSRF | Session token = CSRF token (header kontrolü) |
| IP kısıtlama | CIDR destekli IPv4/IPv6 allowlist |
| Rate limiting | Global 200/dk, Login 5/5dk |
| HTTP güvenliği | Helmet CSP, güvenlik header'ları |
| En az ayrıcalık | Docker'da non-root user |
| Anahtar rotasyonu | Dashboard'tan tek tıkla (eski anında geçersiz) |
| Geçici anahtarlar | Süre + istek limiti ile sınırlı |

---

## 10. Dokümantasyon

`docs/` klasöründe detaylı rehberler:
- `admin-dashboard.md` — Dashboard kullanımı
- `backup-restore.md` — Yedekleme/geri yükleme
- `client-configuration.md` — İstemci kurulumu
- `coolify-deployment.md` — Coolify dağıtımı
- `failover.md` — Failover mekanizması
- `first-time-setup.md` — İlk kurulum
- `managing-keys.md` — Anahtar yönetimi
- `security.md` — Güvenlik
- `troubleshooting.md` — Sorun giderme

---

## 11. Build & Geliştirme Komutları

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme (backend + frontend aynı anda)
npm run dev

# Production build (shared → frontend → backend)
npm run build

# Migration
npm run db:migrate

# Test
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint

# Docker
docker compose up --build -d
```

| Servis | Port |
|--------|------|
| Backend | `http://localhost:4000` |
| Frontend (dev) | `http://localhost:4173` |

---

## 12. Özet

**MiMo API Key Router**, aşağıdaki problemleri çözen bir **AI API gateway** çözümüdür:

1. **Anahtar güvenliği** — Gerçek MiMo anahtarları şifreli saklanır, asla istemciye açığa çıkmaz
2. **Yüksek erişilebilirlik** — Otomatik failover ile bir anahtar başarısız olursa sıradakine geçilir
3. **Maliyet takibi** — Token kullanımı ve tahmini maliyet gerçek zamanlı hesaplanır ve loglanır
4. **Erişim kontrolü** — IP allowlist, geçici anahtarlar, rate limiting ile çok katmanlı güvenlik
5. **Çift uyumluluk** — Hem OpenAI hem Anthropic API formatlarını destekler (Claude Code + Open WebUI)
6. **Görselleştirme** — Canlı istek akış diyagramı ve detaylı analitik dashboard
7. **Kolay dağıtım** — Tek Docker konteyneri, Coolify desteği, non-root güvenlik

**Lisans:** MIT

---

*Bu doküman proje kaynak kodu analiz edilerek 11 Temmuz 2026 tarihinde oluşturulmuştur.*