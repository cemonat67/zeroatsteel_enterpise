Zero@Steel & Chat Gateway

Phase 2 — Ops & Governance Checklist

Scope:
- Zero@Steel Enterprise (Steel UI + Supabase + n8n)
- Chat Gateway (Claude SSE API + UI)

v1.0 Durumu:
- ✅ Zero@Steel v1.0 prod paketi: deploy/ZeroAtSteel_Enterprise_v1.0.zip
- ✅ Chat Gateway v1.0.0: API key auth, rate limit, /healthz, log, retention, sandbox

1. Monitoring & Uptime

1.1. Uptime Monitors
- M1.1 — https://<chat-domain>/healthz için uptime monitor oluştur
- Owner: Cem | Tool: UptimeRobot / BetterStack / Statuscake (tek sağlayıcı) | Target SLO: 99.9% | Due: 7 gün içinde
- M1.2 — https://<steel-domain>/steel/ için uptime monitor | Owner: Cem | Target SLO: 99.9%
- M1.3 — https://<n8n-domain>/healthz için uptime monitor | Owner: Cem | Target SLO: 99.5%

1.2. Alert Kanalları
- M2.1 — Alert kanal(lar)ını tanımla | Email: cemonat67@... | Slack/Telegram (tek kanal seç)
- Owner: Cem | Due: M1.x ile aynı gün

2. Backup & Export

2.1. Supabase
- B1.1 — Haftalık otomatik backup / export planı (Supabase paneli veya cron + pg_dump) → hedef: güvenli bucket (örn. zeroat-backups/supabase/)
- Owner: Cem | Due: 2 hafta
- B1.2 — Restore test planı (en az 1 test) → “Backup var ama geri dönebiliyor muyuz?”
- Owner: Cem | Due: 1 ay

2.2. n8n
- B2.1 — Workflow JSON’ları repoda versiyonlanmış durumda mı teyit et (n8n/*.json → git altında)
- Owner: Cem
- B2.2 — Environment manifest dosyası oluştur (n8n/ENV_MANIFEST.md) → hangi credential nerede tanımlı (isim bazlı, secret yok)
- Owner: Cem

2.3. Release Checksum
- B3.1 — v1.0 ZIP için SHA256 üret ve release’e ekle:
`shasum -a 256 deploy/ZeroAtSteel_Enterprise_v1.0.zip`
- Çıktıyı GitHub Release notlarına ekle | Owner: Cem

3. Staging / Demo Ortamı

3.1. Domain & Environments
- S1.1 — Staging domain belirle (örn. steel-demo.yourdomain.com) | Owner: Cem
- S1.2 — Staging Supabase project aç (ayrı URL, ayrı anon key; demo data immutable) | Owner: Cem
- S1.3 — Staging n8n instance / credentials (prod ile karışmasın) | Owner: Cem

3.2. Config Standardı
- S2.1 — config.example.env dosyasını UI/backend/n8n ile hizala:
```
ENV=staging
SUPABASE_URL=https://<staging>.supabase.co
SUPABASE_KEY=<anon_staging>
N8N_URL=https://n8n-staging.yourdomain.com/webhook
API_KEYS=staging-key:admin
RATE_LIMIT_PER_MINUTE=30
```
- Owner: Cem
- S2.2 — Prod ve staging .env dosyalarını net ayır (config.env.prod, config.env.staging) | Owner: Cem

4. Security Review

4.1. HTTP Header Sertleştirme
- SEC1.1 — Nginx’e temel header’ları ekle:
```
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "no-referrer";
# CSP report-only örnek
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:" always;
```
- Başta report-only da kabul | Owner: Cem
- SEC1.2 — SSE için Nginx ayarını doğrula:
```
proxy_buffering off;
proxy_read_timeout 300;
```
- Owner: Cem

4.2. CORS & Auth
- SEC2.1 — CORS’u sadece kendi domainlerine kısıtla
- Chat API: https://chat.yourdomain.com | Steel UI: https://steel.yourdomain.com
```
cors({
  origin: ['https://chat.yourdomain.com','https://steel.yourdomain.com'],
  credentials: false
})
```
- Owner: Cem
- SEC2.2 — Kritik endpoint’lerde API key zorunlu mu test et (/api/chat, /api/files/*, /api/terminal/exec) → token yoksa 401
- Owner: Cem

4.3. Log Sanitization
- SEC3.1 — Log yazımında şu alanları maskele: api_key, authorization, cookie, password, token | Owner: Cem
- SEC3.2 — Test: sahte api_key=SECRET_TEST isteği gönder, log dosyasında görünmediğini doğrula | Owner: Cem

5. Phase 2 – UX (Ops’a bağlı değil ama planlı)
- UX1.1 — Abort/Cancel butonu (AbortController; UI “Cancel” → request iptali, log: cancelled_by_user) | Owner: Cem
- UX1.2 — Session listesi endpoint (GET /api/session/list → son N + metadata; UI’den seçim/yeniden yükleme) | Owner: Cem
- UX1.3 — Uzun dokümanlar için chunking + özetleme (RAG-light: chunk → özet → session context) | Owner: Cem
- UX1.4 — UI mode dropdown: Steel / Design / General (system prompt + hint’ler mod’a göre) | Owner: Cem

6. Özet Tablo (High-Level)

ID | Area | Task | Priority | Owner | Status
--- | --- | --- | --- | --- | ---
M1.1 | Monitoring | Uptime monitor – chat /healthz | High | Cem | ☐
M1.2 | Monitoring | Uptime monitor – steel /steel/ | High | Cem | ☐
B1.1 | Backup | Supabase weekly backup plan | High | Cem | ☐
S1.1 | Staging | steel-demo subdomain | Medium | Cem | ☐
SEC1.1 | Security | Nginx security headers | High | Cem | ☐
SEC2.1 | Security | CORS restrict to own domains | High | Cem | ☐
SEC3.1 | Security | Log sanitization | High | Cem | ☐
UX1.1 | UX | Abort/Cancel for SSE | Medium | Cem | ☐
UX1.2 | UX | Session list endpoint + UI | Medium | Cem | ☐

Not: Bu dosyayı Notion’da “Zero@Steel & Chat Gateway — Phase 2 Ops” sayfasına aynen yapıştırabilirsin.
