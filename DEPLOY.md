# AdForge — Dağıtım (Deploy) Notları

AdForge iki parçadan oluşur ve **farklı yerlere** dağıtılır:

| Parça | Nerede | Durum |
|------|--------|-------|
| **Landing page** (statik: `public/index.html`) | **Vercel** | Tam uyumlu |
| **Uygulama** (`server.js` + fal hattı + konsol `/app/`) | **Railway / Render** veya lokal | Kalıcı sunucu gerekir |

## Neden uygulama Vercel'de çalışmaz?
Vercel serverless'tir: fonksiyonlar kısa sürede biter, kalıcı disk yoktur, HTTP yanıtından
sonra arka plan işçisi çalışmaz. AdForge ise her video için 2+ dk arka plan polling,
yerel JSON kayıt, dosya yükleme ve yanıt sonrası işçi gerektirir. Bunlar Vercel'de kırılır.

## 1) Landing → Vercel (statik)
1. https://vercel.com → **Add New → Project**
2. GitHub'dan **`adforge`** reposunu **Import** et.
3. Vercel `vercel.json`'u görür → **Output Directory: `public`**, build yok. **Deploy**.
4. `https://adforge-xxx.vercel.app` adresinde landing yayında.

> Not: Bu statik dağıtımda `/app/` arayüzü açılır ama API'si olmadığından üretim yapmaz.
> Landing'in "Uygulamayı aç" butonunu, uygulamanın gerçek adresine (Railway URL'i veya
> demo sırasında lokal `http://localhost:3000/app/`) yönlendir.

## 2) Uygulama → Railway (tam çalışır, online)
1. https://railway.app → **New Project → Deploy from GitHub repo** → `adforge`
2. Start command: `npm start`
3. **Variables**: `FAL_KEY=<anahtarın>` (ve istersen `OPENAI_API_KEY`)
4. Deploy → verilen URL `/app/` üzerinden tam çalışır.
> Kalıcı `data/` için Railway **Volume** ekle (yoksa restart'ta kampanya geçmişi sıfırlanır;
> üretim devam mantığı yine de yarım işleri kurtarır).

## 3) Demo için en pratik (yarın)
- Landing → Vercel (public link).
- Uygulama → **lokal** (`npm start`, `http://localhost:3000/app/`) — gerçek videolar burada hazır.
