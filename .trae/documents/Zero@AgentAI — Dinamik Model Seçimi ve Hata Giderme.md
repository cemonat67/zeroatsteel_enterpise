## Sorunun Özeti
- Anthropic API "not_found_error" veriyor: `model: claude-3-5-sonnet-latest`.
- Nedenler: Hesapta ilgili model yetkisi yok, model adı/alias desteklenmiyor veya ortam bölgesi farklı.
- Çözüm: Kullanılabilir modelleri API’den dinamik okuyup arayüzü buna göre doldurmak ve sunucu/istemci fallback mantığını gerçek listeye bağlamak.

## Teknik Düzeltmeler
1. Sunucu — Modelleri Listeleme
- `GET /api/models` ekle: `anthropic.models.list()` ile `id` listesini döndür.
- Opsiyonel: `DEFAULT_MODEL` ortam değişkeni ile varsayılanı belirle.

2. Sunucu — Chat Endpoint Güçlendirme
- `POST /api/chat` içinde model doğrulaması: İstekle gelen `model` değerinin listeye dahil olup olmadığını kontrol et.
- Değilse otomatik fallback: Öncelik sırası `claude-3-5-haiku-*` → `claude-3-haiku-*` → `claude-2.1` (listeye göre).
- Hata mesajı iyileştirme: `not_found_error` durumunda önerilen model kimliklerini döndür.

3. İstemci — Dinamik Model Seçici
- Açılışta `/api/models` çağır; gelen listeyle `<select>` seçeneklerini doldur.
- Varsayılanı: Listede ilk haiku (en hızlı/erişimi geniş) veya ilk model.
- Gönderimde seçilen model kimliği doğrudan kullanılacak; ek normalizasyonu kaldır.

4. Hata Yönetimi ve Geri Dönüş
- İstemci yanıtı `res.ok` değilse ve içerik `not_found_error` ise: Kullanıcıya seçim için mevcut modelleri göster.
- Otomatik tek seferlik yeniden deneme: Listeden uygun ilk modelle.

5. Güvenlik ve Yapılandırma
- Anahtar yalnızca sunucuda `.env` ile tutulur; istemciye hiçbir koşulda sızdırılmaz.
- CORS ve `express.json` sınırları korunur.

## Doğrulama
- `GET /api/models` çıktısında en az bir model göründüğünü kontrol et.
- Arayüzde model seçimi listeden gelir; seçili modelle `POST /api/chat` başarı.
- Edge case: Liste boşsa arayüz uyarı ve chat butonunu devre dışı bırak.

## Sonraki İyileştirmeler (Opsiyonel)
- Akışlı (streaming) yanıtlar.
- Çoklu ajan profilleri (Zero@Steel, Zero@Supply) için sistem mesajı şablonları.

Onay verirsen bu adımlarla kodu güncelleyip sunucuyu yeniden başlatacağım ve birlikte test edeceğiz.