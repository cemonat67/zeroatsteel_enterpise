Zero@Steel_Enterprise — CANLIYA ÇIKIŞ README v1.0

1) Supabase Projesini Aç
- Yeni Supabase Project oluştur
- Project URL, anon key, service_role key not et

2) Schema.sql + Ek SQL Dosyalarını Çalıştır
- Supabase → SQL Editor → Run:
- backend/schema.sql
- backend/rolling_energy.sql
- backend/scrap_suppliers.sql
- backend/rls_policies.sql
- Sonuç: 16 tablo + views + RLS aktif + seed data yüklenmiş

3) Storage Bucket Aç
- Supabase → Storage → Create bucket: zeroatsteel-passports (public)
- QR & passport dosyaları buraya yüklenecek

4) n8n’i Hazırla
- n8n URL: https://<domain>/
- 6 workflow import et:
- zeroatsteel_furnace_ingest.json
- zeroatsteel_h2_blending_optimizer.json
- zeroatsteel_rolling_kpi.json
- zeroatsteel_cbam_simulator.json
- zeroatsteel_passport_and_alerts.json
- ai_analyze_webhook.json
- Env vars:
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ROLLING_CO2_THRESHOLD=300
- Workflow’ları Activate et

5) UI Config’i Düzenle (Prod Endpointleri)
- ui/assets/js/config.js içini doldur:
- ENV, SUPABASE_URL, SUPABASE_KEY, N8N_URL

6) Mock Data Çağrılarını Kapat
- Tüm sayfalarda mockData kullanımı kaldır
- Supabase REST çağrısı kullan:
- fetch(`${SUPABASE_URL}/rest/v1/furnaces?select=*`)

7) Nginx Reverse Proxy Ayarla
- /steel/ → UI (statik)
- /steel/api/ → n8n webhook
- /steel/passport/ → Supabase storage public URLs
- SSE için: proxy_read_timeout 300; proxy_buffering off;

8) SSL ile Güvende Çalış
- Let’s Encrypt/Cloudflare SSL
- HTTP → HTTPS redirect
- n8n + UI + Supabase çağrıları sadece HTTPS

9) Sanity Test (4 API Çağrısı)
- curl -X POST https://n8n.yourdomain.com/webhook/zero-steel/furnace-ingest
- curl -X POST https://n8n.yourdomain.com/webhook/zero-steel/h2-opt
- curl -X POST https://n8n.yourdomain.com/webhook/zero-steel/cbam-sim
- curl -X POST https://n8n.yourdomain.com/webhook/zero-steel/passport
- Supabase’da tablolar doluyor mu kontrol et

10) UI’yi Aç ve 6 Modülü Test Et
- https://yourdomain.com/steel/
- Dashboard, Furnaces, Production, Analytics, Reports (PDF), AI Assist
- Hepsi OK ise canlıdasın
