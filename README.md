# AdForge — UGC reklam varyant motoru

DTC/e-ticaret markaları için: **tek ürün fotoğrafı + kısa brief → 10 UGC reklam varyantı + performans raporu.**

Sıradan video araçlarından farkı tek varlık değil, A/B testi için onlarca varyant üretmesi ve hangisinin dönüşeceğine dair tahmini skor sunmasıdır. Arka planda fal.ai modellerini zincirler; markanın "sürekli yeni reklam test etme" döngüsünü dakikalara indirir.

## Nasıl çalışır (5 aşama)

```
1) PLAN      brief → N farklı hook/script (TR veya EN)
2) COMPOSE   ürün fotoğrafı → her (avatar × tarz) için sahne görseli   [nano-banana]
3) ANIMATE   her (avatar × hook) → konuşan video                        [Veo 3.1 / Seedance]
4) SUBTITLE  her video → TR/EN altyazı (ayrı model, şema-güvenli)        [auto-subtitle]
5) SCORE     her varyant → 0-100 tahmini skor + sıralama + kazanan
```

Varsayılan: **5 hook × 2 avatar = 10 varyant.** (v1; formdan ayarlanabilir)

## Kurulum

1. `.env.example` → `.env` kopyala, `FAL_KEY` yapıştır. (İstersen `ANTHROPIC_API_KEY` ekle — hook ve skorları LLM ile zenginleştirir; **boş olsa da çalışır**, dahili şablon/heuristik devreye girer.)
2. `npm install`
3. `npm start` → <http://localhost:3000>

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

- **Doğrulama:** fal endpoint ID/fiyatları 2026-05'te doğrulandı; fal revize edebilir. İlk gerçek çalıştırmada bir varyant üretip doğrula (`lib/models.js` tek değişiklik noktası).
- **Maliyet onayı:** Üretim öncesi canlı maliyet gösterilir ve onay istenir.
- **Hata modları:** 422 (prompt reddedildi, para kesilmez) ve 500 (video üretildi ama çekilemedi) varyant bazında yakalanır; diğer varyantlar etkilenmez.
- **Resume:** Sunucu yeniden başlarsa yarım kalan varyantlar kaldığı yerden devam eder (pahalı video yeniden submit edilmez).
- **Güvenlik:** API anahtarları sadece `.env`'de. App yalnızca localhost. Public deploy için kimlik doğrulama + ödeme katmanı eklenmeli.
