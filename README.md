# AdForge — UGC reklam varyant motoru

> Aktif olarak [OpenAI Codex](https://openai.com/codex/) ile geliştiriliyor ve bakımı yapılıyor.

DTC/e-ticaret markaları için: **tek ürün fotoğrafı + kısa brief → 10 UGC reklam varyantı + performans raporu.**

Sıradan video araçlarından farkı tek varlık değil, A/B testi için onlarca varyant üretmesi ve hangisinin dönüşeceğine dair tahmini skor sunmasıdır. **Varsayılan motor tamamen yerel ve ücretsizdir** (API anahtarı gerektirmez); istenirse fal.ai motorları opsiyonel olarak açılır.

## Üç üretim motoru

| | `faceless` (varsayılan, YEREL) | `avatar` (hibrit, Kling) | `veo` (fal.ai) |
|---|---|---|---|
| Format | Ürün B-roll + hook + seslendirme + karaoke altyazı | **Fotogerçekçi konuşan avatar** (lipsync) + karaoke altyazı | Konuşan avatar (native ses) |
| Maliyet | **$0** | **~$0.60-0.90/video** (sahne $0.04 + $0.056/sn; ses+altyazı yerel $0) | ~$1.20+ / 8 sn |
| Süre | 15–30 sn | ses uzunluğu kadar (~8-15 sn) | 4–15 sn |
| Gereksinim | Anahtar yok | `FAL_KEY` | `FAL_KEY` |
| Ses | Edge neural TR/EN (8 persona, rate/pitch) | Aynı Edge sesleri (tam kontrol) | Veo native |
| Altyazı | Karaoke, WordBoundary senkron | Karaoke, WordBoundary senkron | fal auto-subtitle |

**Önerilen akış (kazanan hunisi):** hook/script varyantlarını `faceless` ile $0'a test et → kazanan 1-2 hook'u `avatar` ile üst seviye üret. 20 varyantlık testin toplam maliyeti ~$1.20 olur (hepsini avatar'la üretmek ~$12-18 olurdu).

## Nasıl çalışır: araştırma → üretim → test → öğrenme

```
0) RESEARCH  rakip reklam metinleri / Winning Product Finder çıktısı → kanıtlanmış açılar
1) PLAN      brief (+ kanıtlanmış açılar) → N farklı hook/script (TR veya EN)
2) COMPOSE   ürün fotoğrafı → her (avatar × tarz) için sahne görselleri
             yerel: sharp (hero/close/detail/card)   fal: nano-banana
3) ANIMATE   her (avatar × hook) → video
             yerel: edge-tts + ffmpeg zoompan + .ass burn   fal: Veo 3.1 / Seedance
4) SUBTITLE  fal yolu: auto-subtitle. Yerel yol: altyazı 3. aşamada gömülür, atlanır.
5) SCORE     her varyant → 0-100 skor + sıralama + kazanan
             (OPENAI_API_KEY varsa LLM, yoksa kural tabanlı yerel skorer)
6) LEARN     gerçek reklam sonuçları (gösterim/tık/dönüşüm/harcama) → gerçek kazanan
             + açı bazında öğrenilen ağırlıklar → bir sonraki kampanyanın skorlaması
```

### 0) Rakip araştırması (opsiyonel)

Formdaki **Rakip araştırması** alanına uzun süredir yayında olan rakip reklam metinlerini (her biri ayrı satırda) ya da **Winning Product Finder** JSON çıktısını yapıştır. `lib/research.js` her reklamın hangi psikolojik açıyı kullandığını kural tabanlı çıkarır (Türkçe + İngilizce, API'siz). Ağırlıklandırma reklamın gücüne göre yapılır: WPF skoru varsa o, yoksa yayında kalma süresi. Planner kanıtlanmış açıları önce dener; LLM açıksa rakip hook'ları **mekanizmayı öğrenmek için** referans olarak alır, metni kopyalaması açıkça yasaktır. Her hook'ta `researchBacked` ve dayandığı rakip açılışı (`reference`) görünür.

### 6) Öğrenme döngüsü

Varyantlar yayına girince raporun altındaki **Gerçek reklam sonuçlarını gir** tablosuna reklam yöneticisindeki rakamları gir (ya da `POST /api/campaigns/:id/results`).

- **Gerçek kazanan:** dönüşüm ve harcama varsa en düşük CPA, yoksa en yüksek CTR. Rapor, tahminin tutup tutmadığını da gösterir.
- **Küçük örneklem koruması:** `LEARN_MIN_IMPRESSIONS` (varsayılan 1000) altındaki varyant ya da açı karar dışı kalır. Tek bir şanslı varyant stratejiyi yönlendiremez.
- **Öğrenilen ağırlıklar:** tüm kampanyalardaki sonuçlar açı bazında toplanır (`GET /api/learnings`). Yeterli veri biriken açılar için skorlayıcı, elle yazılmış ağırlık tablosu yerine markanın **kendi** verisini kullanır. Öncelik: öğrenilmiş > araştırmada kanıtlanmış > varsayılan. Skor gerekçesinde kaynak yazılır.

Varsayılan: **5 hook × 2 avatar = 10 varyant.** (v1; formdan ayarlanabilir)

## Kurulum

1. `npm install` (testler: `npm test`, bağımlılıksız `node:test`)
2. `npm start` → <http://localhost:3000> — **anahtar olmadan üretim yapar** (yerel motor).
3. (Opsiyonel) `.env.example` → `.env` kopyala: `FAL_KEY` (veo motoru), `OPENAI_API_KEY` (LLM hook/skor), TTS ses/Piper ayarları.

> **OneDrive notu:** Proje OneDrive altındaysa `data/` klasörünü "Bu cihazda her zaman tut" yap; render sırasında eşitleme kilidi yaşarsan `KEEP_TEMP=0` kalsın ve `data/renders`'ı OneDrive eşitlemesinden hariç tutmayı düşün.

## Mimari ve genişleme noktaları

Her şey **registry** desenli — yeni özellik = tek dosya/nesne:

| Eklemek istediğin | Dosya | Nasıl |
|---|---|---|
| Yeni **tarz** | `lib/styles.js` | `STYLES`'a bir nesne ekle |
| Yeni **avatar** | `lib/avatars.js` | `AVATARS`'a bir nesne ekle (sonra: `source:'uploaded'`) |
| Yeni **üretim motoru** | `lib/engines/` | Arayüzü implement et + `engines/index.js`'e ekle |
| Yeni **skorlayıcı** | `lib/scorers/` | Arayüzü implement et + `scorers/index.js`'e ekle |
| Model/fiyat | `lib/models.js` | Sabit havuz — tek kaynak |

**Yol haritası:** v1 = Veo motoru + AI tahmini skor. v2 = zincir motoru (görsel→TTS→lipsync ekonomi katmanı, `lib/engines/chain.js`) + gerçek platform skorlayıcısı (Meta/TikTok, `lib/scorers/platform.js`) — ikisi de mevcut arayüzlere takılır, omurga değişmez.

## Önemli notlar

- **AI içerik etiketi:** `faceless` ve `avatar` motorlarında her videonun sol üst köşesine, videonun tamamı boyunca "Yapay zeka ile üretilmiştir" (EN: "AI-generated") basılır. `AI_DISCLOSURE` ile metin değiştirilebilir; `off` kapatır (kapatmak önerilmez, yayın kurallarını kontrol et). **`veo` motorunda** altyazı fal.ai tarafında üretildiği için etiket otomatik basılmaz; yayından önce platformun AI içerik işaretini kullan ya da etiketi kurguda ekle.

- **Doğrulama:** fal endpoint ID/fiyatları 2026-05'te doğrulandı; fal revize edebilir. İlk gerçek çalıştırmada bir varyant üretip doğrula (`lib/models.js` tek değişiklik noktası).
- **Maliyet onayı:** Üretim öncesi canlı maliyet gösterilir ve onay istenir.
- **Hata modları:** 422 (prompt reddedildi, para kesilmez) ve 500 (video üretildi ama çekilemedi) varyant bazında yakalanır; diğer varyantlar etkilenmez.
- **Resume:** Sunucu yeniden başlarsa yarım kalan varyantlar kaldığı yerden devam eder (pahalı video yeniden submit edilmez).
- **Güvenlik:** API anahtarları sadece `.env`'de. App yalnızca localhost. Public deploy için kimlik doğrulama + ödeme katmanı eklenmeli.
