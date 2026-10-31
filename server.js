// server.js — AdForge yerel sunucu (Express).
// Marka: urun fotografi + brief -> 20 UGC varyanti + performans raporu.
// Varsayilan motor YEREL (faceless: tts + ffmpeg, ucretsiz). fal.ai OPSIYONEL:
// FAL_KEY eklenirse veo motoru da acilir.

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;
// Ucretli (fal) motorlarda tek kampanyanin tahmini maliyet tavani. Kazara 64 varyantlik
// ~$38'lik avatar/veo kampanyasini engeller. .env ile ayarlanabilir (varsayilan $5).
const MAX_SPEND_USD = parseFloat(process.env.MAX_SPEND_USD || '5');
if (!FAL_KEY) {
  console.log('\n[BILGI] FAL_KEY yok — yerel motor (faceless) aktif, fal.ai motorlari kapali. Bu normal ve ücretsizdir.');
}

const store = require('./lib/store');
const { estimateCampaign } = require('./lib/cost');
const { listStyles, defaultStyle } = require('./lib/styles');
const { listAvatars } = require('./lib/avatars');
const { LEVELS } = require('./lib/models');
const { listEngines, getEngine, DEFAULT_ENGINE, engineNeedsFal } = require('./lib/engines');
const { listScorers, DEFAULT_SCORER } = require('./lib/scorers');
const { llmAvailable } = require('./lib/llm');
const { ttsInfo } = require('./lib/tts');
const pipeline = require('./lib/pipeline');
const demo = require('./lib/demo');
const { analyzeResearch } = require('./lib/research');
const { angleLearnings } = require('./lib/learnings');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// yerel depolama: yuklenen urun gorselleri + render ciktilari.
// Guvenlik: yuklenen icerik tarayicida CALISTIRILMAMALI (HTML/SVG -> XSS). Bu yuzden
// /uploads her yaniti indirilebilir ek (attachment) + sniff kapali olarak sunar.
const safeUploadHeaders = (res) => {
  res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
};
app.use('/uploads', express.static(store.UPLOADS_DIR, { setHeaders: safeUploadHeaders }));
app.use('/renders', express.static(store.RENDERS_DIR));

// Yalniz gorsel kabul et — tur allowlist (hem MIME hem uzanti). SVG kasitli DISARIDA:
// icinde script tasiyabilir; raster formatlar guvenli.
const ALLOWED_IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  dest: store.UPLOADS_DIR,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE[file.mimetype]) return cb(null, true);
    cb(new Error('Sadece JPG, PNG, WebP veya GIF görsel yüklenebilir.'));
  },
});

// --- meta & saglik ---
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    falKey: FAL_KEY ? 'present' : 'missing',
    localEngine: true,
    defaultEngine: DEFAULT_ENGINE,
    tts: ttsInfo(),
    llm: llmAvailable(),
  });
});

app.get('/api/meta', (req, res) => {
  res.json({
    styles: listStyles().map((s) => ({ id: s.id, label: s.label, desc: s.desc, isDefault: !!s.isDefault })),
    avatars: listAvatars().map((a) => ({ id: a.id, label: a.label, energy: a.energy })),
    levels: Object.entries(LEVELS).map(([id, l]) => ({ id, label: l.label, pricePerSec: l.pricePerSec, family: l.family, engine: l.engine || null })),
    engines: listEngines(),
    scorers: listScorers(),
    defaults: { style: defaultStyle().id, engine: DEFAULT_ENGINE, scorer: DEFAULT_SCORER, avatars: 2, hooks: 5 },
    llm: llmAvailable(),
  });
});

// --- maliyet tahmini (canli) ---
app.get('/api/cost', (req, res) => {
  const avatars = parseInt(req.query.avatars || '5', 10);
  const hooks = parseInt(req.query.hooks || '4', 10);
  const styleCount = parseInt(req.query.styleCount || '1', 10);
  const level = req.query.level || 'standart';
  const duration = req.query.duration || '8s';
  res.json(estimateCampaign({ avatars, hooks, styleCount, level, duration }));
});

// --- urun gorseli yukle (YEREL disk — fal'a gitmez; fal motoru gerekirse
//     pipeline lazy olarak CDN'e yukler) ---
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    // multer fileFilter/limit hatasi -> 400 (allowlist disi tur veya cok buyuk)
    if (err) return res.status(400).json({ error: err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
      // uzanti DOGRULANMIS MIME'den turetilir (orijinal isim degil) — .html/.svg sizamaz
      const ext = ALLOWED_IMAGE[req.file.mimetype];
      const name = `${path.basename(req.file.path)}${ext}`;
      fs.renameSync(req.file.path, path.join(store.UPLOADS_DIR, name));
      res.json({ url: `/uploads/${name}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// --- kampanya olustur + uretimi baslat ---
app.post('/api/campaigns', (req, res) => {
  try {
    const b = req.body || {};
    const product = (b.product || '').trim();
    if (!product) return res.status(400).json({ error: 'Ürün/marka zorunlu.' });

    // motor <-> seviye tutarliligi: adanmis seviyeler (yerel/avatar) motorunu zorlar;
    // adanmis motor secilmisse seviyesi de esler.
    const ENGINE_LEVEL = { faceless: 'yerel', avatar: 'avatar' };
    let engineId = b.engine || DEFAULT_ENGINE;
    let level = b.level || 'standart';
    if (LEVELS[level]?.engine) engineId = LEVELS[level].engine;
    const eng = getEngine(engineId);
    if (ENGINE_LEVEL[eng.id] && level !== ENGINE_LEVEL[eng.id]) level = ENGINE_LEVEL[eng.id];

    // fal isteyen motorlar anahtarsiz calismaz — yerel motor her zaman serbest
    if (engineNeedsFal(eng) && !FAL_KEY) {
      return res.status(400).json({ error: 'Bu motor fal.ai anahtarı ister. Yerel (ücretsiz) motoru seç veya .env içine FAL_KEY ekle.' });
    }

    const DEFAULT_DURATION = { faceless: '15s', avatar: '10s' };
    const config = {
      avatars: clampInt(b.avatars, 1, 8, 2),
      hooks: clampInt(b.hooks, 1, 8, 5),
      styles: Array.isArray(b.styles) && b.styles.length ? b.styles.slice(0, 8) : [defaultStyle().id],
      level,
      duration: b.duration || DEFAULT_DURATION[eng.id] || '8s',
      engine: eng.id,
      subtitles: b.subtitles !== false, // altyazi opsiyonel (varsayilan acik)
    };
    const cost = estimateCampaign({
      avatars: config.avatars, hooks: config.hooks, styleCount: config.styles.length, level: config.level, duration: config.duration,
    });

    // SUNUCU TARAFI HARCAMA KORUMASI (frontend confirm() curl ile atlanabilir).
    // Ucretli motorlarda tahmini toplam esigi asarsa uretimi baslatma.
    if (engineNeedsFal(eng) && cost.total > MAX_SPEND_USD) {
      return res.status(402).json({
        error: `Tahmini maliyet $${cost.total.toFixed(2)}, izin verilen üst sınır $${MAX_SPEND_USD.toFixed(2)}. Varyant sayısını azalt veya MAX_SPEND_USD değerini artır.`,
        estimated: cost.total, cap: MAX_SPEND_USD,
      });
    }

    // Rakip arastirmasi (opsiyonel): duz metin ya da Winning Product Finder JSON'u.
    // Ham metin saklanmaz; yalnizca cikarilan aci ozeti ve kisa referans acilislari.
    const research = b.research ? analyzeResearch(b.research) : null;

    const campaign = store.createCampaign({
      brand: { name: (b.brandName || '').trim(), language: b.language === 'en' ? 'en' : 'tr' },
      brief: { product, benefit: (b.benefit || '').trim(), audience: (b.audience || '').trim(), tone: (b.tone || '').trim() },
      config,
      productImageUrl: b.productImageUrl || null,
      cost: { estimated: cost.total, actual: 0 },
    });
    store.updateCampaign(campaign.id, {
      scorer: b.scorer || DEFAULT_SCORER,
      costDetail: cost,
      research: research && research.total ? research : null,
    });

    pipeline.produceCampaign(campaign.id); // arka planda
    res.json({ campaignId: campaign.id, cost });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- demo kampanyasi (anahtar GEREKMEZ) ---
app.post('/api/demo', (req, res) => {
  try {
    const c = demo.createDemoCampaign(req.body || {});
    res.json({ campaignId: c.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/campaigns', (req, res) => {
  res.json(store.listCampaigns().map(summary));
});

// ID format guvenligi: campaignId (cmp_hex) ve variantId (var_hex) fs yollarina
// giriyor; yol geciskenligini (path traversal) engellemek icin bicimi dogrula.
const ID_RE = /^(cmp|var|demo)_[a-f0-9]+$/;
function validIds(...ids) {
  return ids.every((id) => typeof id === 'string' && ID_RE.test(id));
}

app.get('/api/campaigns/:id', (req, res) => {
  if (!validIds(req.params.id)) return res.status(400).json({ error: 'Geçersiz kampanya kimliği' });
  const c = store.readCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json(c);
});

app.delete('/api/campaigns/:id', (req, res) => {
  if (!validIds(req.params.id)) return res.status(400).json({ error: 'Geçersiz kampanya kimliği' });
  store.deleteCampaign(req.params.id);
  // yerel render ciktilarini da temizle (disk sismesin)
  fs.rmSync(path.join(store.RENDERS_DIR, req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.post('/api/campaigns/:id/variants/:vid/retry', (req, res) => {
  if (!validIds(req.params.id, req.params.vid)) return res.status(400).json({ error: 'Geçersiz kimlik' });
  const v = store.getVariant(req.params.id, req.params.vid);
  if (!v) return res.status(404).json({ error: 'Varyant bulunamadı' });
  pipeline.retryVariant(req.params.id, req.params.vid);
  res.json({ ok: true });
});

// --- arastirma onizleme: kampanya acmadan rakip metinlerinin aci ozeti ---
app.post('/api/research/preview', (req, res) => {
  try {
    res.json(analyzeResearch((req.body || {}).research));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- gercek reklam sonuclari (ogrenme dongusu) ---
// Body: { results: [{ variantId, impressions, clicks, conversions, spend }] }
app.post('/api/campaigns/:id/results', (req, res) => {
  if (!validIds(req.params.id)) return res.status(400).json({ error: 'Geçersiz kampanya kimliği' });
  const results = Array.isArray(req.body?.results) ? req.body.results.slice(0, 200) : [];
  if (!results.every((r) => r && validIds(r.variantId))) {
    return res.status(400).json({ error: 'Geçersiz varyant kimliği' });
  }
  const out = pipeline.recordResults(req.params.id, results);
  if (!out) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json(out);
});

// --- markanin tum kampanyalarindan ogrenilen aci performansi ---
app.get('/api/learnings', (req, res) => {
  res.json(angleLearnings(store.listCampaigns()));
});

// kampanya liste ozeti (varyant detaylarini gondermeden)
function summary(c) {
  const total = (c.variants || []).length;
  const done = (c.variants || []).filter((v) => v.status === 'completed').length;
  return {
    id: c.id, createdAt: c.createdAt, status: c.status, demo: !!c.demo,
    brand: c.brand, product: c.brief?.product,
    config: c.config, cost: c.cost,
    counts: { total, done },
    topScore: c.report?.ranked?.[0]?.value ?? null,
  };
}

function clampInt(v, lo, hi, def) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

app.listen(PORT, () => {
  console.log(`\n  AdForge → http://localhost:${PORT}`);
  console.log(`  Motor: ${DEFAULT_ENGINE} (yerel, ücretsiz)   fal.ai: ${FAL_KEY ? 'bağlı ✓ (opsiyonel)' : 'yok (opsiyonel)'}   LLM (hook/skor): ${llmAvailable() ? 'açık (Anthropic)' : 'şablon/kural modu'}\n`);
  pipeline.resumePending();
});
