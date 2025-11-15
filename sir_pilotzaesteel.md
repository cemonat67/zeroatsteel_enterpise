# Zero@Steel v3 Pilot — Uygulama Bilgisi

## Genel Mimari
- Katmanlar: Chat Gateway (`Node.js + Express`), Steel UI (`HTML+JS`), Supabase (Auth + DB + REST), n8n (operasyon akışları), Nginx (reverse proxy + güvenlik).
- Modlar: `steel`, `design`, `general` — sistem mesajı ve bağlam mod’a göre şekillenir (`server.js:670–674`).
- SSE Pipeline: Tek giriş alanı; Claude üretim, OpenAI validator kontrol; pass/fail döngüsü ve final çıktı (`server.js:612–730`).

## Bileşenler
- Chat Gateway
  - Yol: `server.js`
  - İşlevler:
    - `GET /api/pipeline/stream`: SSE sohbet akışı; tek alan girdi → Claude; OpenAI validator pass → final; fail → geri besleme.
    - `POST /api/chat/cancel`: `session_id` bazlı iptal.
    - `GET /api/models` ve `GET /api/openai/models`: model listesi.
    - `POST /api/chat` ve `POST /api/openai/chat`: senkron tek istekle yanıt üretimi.
    - `POST /api/files/save`: text + image + pdf/docx → metin çıkarımı ve kaydetme.
    - `GET /api/files/:id`: dosya içeriği.
    - `POST /api/rag/index`: chunk + embedding üretimi; dosyaları indeksler.
    - `POST /api/rag/query`: serbest sorgu; top‑k sonuç.
    - `GET /api/session/list` / `GET /api/session/:id`: sohbet oturum listesi ve yükleme.
    - `GET/POST/DELETE /api/alert-rules`: JSON basit store ile alert kuralları.
    - `POST /api/auto/cbam-report`: CBAM rapor kuyruğuna alır (n8n akışını tetiklemek için).
    - `POST /api/reports/cbam`: n8n CBAM webhook’una bağlanır; `pdf_url` ya da `pdf_base64` döner; `data/reports` altına yazar ve link verir.
    - `GET /api/reports/file/:name`: oluşturulmuş PDF’i servis eder.
    - `POST /api/terminal/exec`: sandbox’ta allowlist komutlar.
    - `GET /healthz`: JSON sağlık bilgisi.
- Steel UI
  - Yol: `ZeroAtSteel_Enterprise/ui/index.html`, `ZeroAtSteel_Enterprise/ui/assets/js/app.js`
  - İşlevler:
    - Executive KPIs: ETS/CBAM/Electricity/H₂ kartları.
    - Executive Calculators: CBAM hesaplayıcı + CBAM Report kuyruğu + CBAM PDF indirme.
    - Executive Scenarios: ROI ve maliyet analiz; preset butonları; CSV export.
    - Plant Metadata: `TKSE_DUISBURG_MAIN` bilgisi.
    - RAG Upload: çoklu `.pdf/.docx/.txt` yükleme → Chat Gateway’e kaydet → indeks.
    - Mini Charts: `rolling_energy` zaman serisinden kWh/ton ve CO₂/ton mini grafik.
    - AI Companion: iframe ile Chat UI, `mode=steel` parametresiyle.
- Supabase
  - Auth: JWT doğrulama ve `role` mapping (`admin`, `exec`, `engineer`, `operator`).
  - DB tabloları: `enterprise_settings`, `plant_metadata`, `rolling_energy` (ve diğer üretim tabloları).
- n8n
  - Webhook örneği: `ZeroAtSteel_Enterprise/n8n/ai_analyze_webhook.json`.
  - CBAM PDF flow: `N8N_URL/zero-steel/cbam-sim` (beklenen çıktı alanları: `pdf_url` veya `pdf_base64`).
- Nginx
  - Reverse proxy ve güvenlik başlıkları; SSE için buffering kapalı.
  - Örnek: `deploy/nginx.conf` (route ve header şablonu).

## RAG-lite
- İndeksleme: `POST /api/rag/index` → `data/rag/*.json` içinde `{title, chunks: [{text, embedding}]}` kaydı.
- Sorgu: `POST /api/rag/query` → cosine benzerliğiyle top‑k döndürür.
- Pipeline steel modu: Kullanıcı mesajını embedleyip top‑3 chunk “RAG context” olarak sisteme eklenir (`server.js:668–688`).

## Dosyalar ve Upload
- `POST /api/files/save`:
  - `text`: direkt metin kaydı.
  - `image/*`: base64 veri, MIME ile kaydetme.
  - `application/pdf`: `pdf-parse` ile metin çıkarımı.
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`: `mammoth` ile metin çıkarımı.
- Saklama: `data/files/<id>.json`.

## Alert Rules
- CRUD uç noktalar: `GET/POST/DELETE /api/alert-rules` (`server.js:266`, `server.js:274`, `server.js:290`).
- UI: `ZeroAtSteel_Enterprise/ui/alert_rules.html`, `assets/js/alert_rules.js`.

## Auth & Roller
- JWT doğrulama: `SUPABASE_JWT_SECRET` ile token decode (`server.js:172–203`).
- Roller:
  - `admin`: tüm erişimler açık.
  - `engineer`: Analytics + Files + Terminal + History.
  - `exec`: Executive + History; Terminal/Files kapalı.
  - `operator`: Action Cards + basit chat; Terminal/Files/History kapalı.
- Chat UI görünürlük: `public/app.js:425`.

## Güvenlik
- CORS: `ALLOWED_ORIGINS` whitelist, `server.js:23–28`.
- Güvenlik başlıkları: `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy (frame-ancestors)` (`server.js:32–36`).
- Health: `GET /healthz` JSON (`server.js:857`).
- Sandbox terminal: `TERMINAL_ENABLED=true` + allowlist komutlar.

## Ortam Değişkenleri
- Chat Gateway
  - `API_KEYS`: `key:role` çiftleri (ör. `testkey:admin`).
  - `OPENAI_API_KEY` veya `OPENAI_API_KEYS`: RAG ve validator için anahtar(lar).
  - `ANTHROPIC_API_KEY` veya `ANTHROPIC_API_KEYS`: Claude üretim.
  - `CLAUDE_MAX_CONCURRENCY`, `OPENAI_MAX_CONCURRENCY`.
  - `RATE_LIMIT_PER_MINUTE`.
  - `BACKOFF_MAX_ATTEMPTS`, `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`.
  - `FILE_CONTEXT_LIMIT_CHARS`, `MAX_FILE_SIZE_MB`, `RETENTION_DAYS`.
  - `TERMINAL_ENABLED`, `SAND_BOX_DIR`, `ALLOWED_IPS`.
  - `SUPABASE_JWT_SECRET` (JWT doğrulama).
  - `N8N_URL` (CBAM PDF webhook ana URL, ör. `https://n8n.zeroatecosystem.com/webhook`).
- Steel UI Config (`ZeroAtSteel_Enterprise/ui/assets/js/config.js`)
  - `ENV`, `SUPABASE_URL`, `SUPABASE_KEY`, `N8N_URL` (UI tarafında n8n analiz çağrıları için), `CHAT_URL`, `CHAT_API`.

## Dağıtım ve Çalıştırma
- Lokalde Chat Gateway (5174):
  - `OPENAI_API_KEY="<key>" PORT=5174 API_KEYS="testkey:admin" node server.js`
- Steel UI (statik):
  - Nginx üzerinden `/steel/` route’u ile servis.
- Prod Domain ve Proxy (örnek):
  - Domain: `steel.zeroatecosystem.com`
  - Nginx yönlendirme:
    - `/` → Steel UI
    - `/api/` → Chat Gateway (`http://localhost:5174/api/`)
    - `/healthz` → Chat Gateway health (`http://localhost:5174/healthz`)
  - SSE için: `proxy_buffering off; proxy_read_timeout 300s;`.
  - CORS & CSP env’lerini prod domainlere sabitle (`ALLOWED_ORIGINS`, `FRAME_ANCESTORS`).

## n8n CBAM PDF Akışı
- UI “Download CBAM PDF” → `POST /api/reports/cbam`:
  - Body: `{ tonnage, intensity_tco2_per_ton, ets_eur_per_tco2, elec_eur_per_mwh, h2_eur_per_kg, h2_blend }`.
  - n8n beklenen cevap: `{ pdf_url }` veya `{ pdf_base64 }`.
  - `pdf_base64` ise dosya `data/reports/<id>.pdf` ve link: `/api/reports/file/<id>.pdf`.

## Monitoring ve Sağlık
- Health endpoint: `GET /healthz` → `{status:"ok", uptime_sec, openai_ok, anthropic_ok, fs_writable}`.
- Uptime monitörleri: Chat, Steel UI, n8n health.

## Bilinen Gereksinimler (Pilot → Saha)
- Supabase veri seti:
  - `enterprise_settings`: ETS, elektrik, doğalgaz, H₂, scrap, emission factors (TKSE sahaya uygun değerlerle).
  - `plant_metadata`: `TKSE_DUISBURG_MAIN` + ek tesisler.
  - `rolling_energy`: kwh/ton ve co₂/ton zaman serisi (mini chart için).
- OpenAI anahtarı:
  - RAG embedding için servis ortamında tanımlı olmalı (`OPENAI_API_KEY` veya `OPENAI_API_KEYS`).
- n8n akışları:
  - CBAM PDF üretimini tamamlayıp `pdf_url`/`pdf_base64` döndürmesi.
- Nginx prod:
  - Domain, SSL, reverse proxy, CORS/CSP sabitlemeleri.

## Hızlı Test Komutları
- RAG indeks:
  - `curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: testkey' -d '{"title":"Pilot Doc","file_ids":["<file_id>"]}' http://localhost:5174/api/rag/index`
- CBAM PDF (N8N_URL set edilince):
  - `curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: testkey' -d '{"tonnage":1000,"intensity_tco2_per_ton":1.8,"ets_eur_per_tco2":80,"elec_eur_per_mwh":120,"h2_eur_per_kg":5,"h2_blend":0.2}' http://localhost:5174/api/reports/cbam`
- Healthz:
  - `curl -s http://localhost:5174/healthz`

## Konumlar ve Yol Referansları
- Chat Gateway: `server.js`
- Public Chat UI: `public/index.html`, `public/app.js`
- Steel UI: `ZeroAtSteel_Enterprise/ui/index.html`, `ZeroAtSteel_Enterprise/ui/assets/js/app.js`, `ZeroAtSteel_Enterprise/ui/assets/js/config.js`
- SQL ve n8n: `ZeroAtSteel_Enterprise/backend/*.sql`, `ZeroAtSteel_Enterprise/n8n/*.json`
- Proxy: `deploy/nginx.conf`
- Depolama dizinleri: `data/files/`, `data/rag/`, `data/sessions/`, `data/reports/`, `data/logs/`

