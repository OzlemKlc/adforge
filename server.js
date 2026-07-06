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

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// yerel depolama: yuklenen urun gorselleri + render ciktilari
app.use('/uploads', express.static(store.UPLOADS_DIR));
app.use('/renders', express.static(store.RENDERS_DIR));

const upload = multer({ dest: store.UPLOADS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

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
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
    const name = `${path.basename(req.file.path)}${ext}`;
    fs.renameSync(req.file.path, path.join(store.UPLOADS_DIR, name));
    res.json({ url: `/uploads/${name}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
      styles: Array.isArray(b.styles) && b.styles.length ? b.styles : [defaultStyle().id],
      level,
      duration: b.duration || DEFAULT_DURATION[eng.id] || '8s',
      engine: eng.id,
      subtitles: b.subtitles !== false, // altyazi opsiyonel (varsayilan acik)
    };
    const cost = estimateCampaign({
      avatars: config.avatars, hooks: config.hooks, styleCount: config.styles.length, level: config.level, duration: config.duration,
    });

    const campaign = store.createCampaign({
      brand: { name: (b.brandName || '').trim(), language: b.language === 'en' ? 'en' : 'tr' },
      brief: { product, benefit: (b.benefit || '').trim(), audience: (b.audience || '').trim(), tone: (b.tone || '').trim() },
      config,
      productImageUrl: b.productImageUrl || null,
      cost: { estimated: cost.total, actual: 0 },
    });
    store.updateCampaign(campaign.id, { scorer: b.scorer || DEFAULT_SCORER, costDetail: cost });

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

app.get('/api/campaigns/:id', (req, res) => {
  const c = store.readCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Kampanya bulunamadı' });
  res.json(c);
});

app.delete('/api/campaigns/:id', (req, res) => {
  store.deleteCampaign(req.params.id);
  // yerel render ciktilarnii da temizle (disk sismesin)
  fs.rmSync(path.join(store.RENDERS_DIR, req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.post('/api/campaigns/:id/variants/:vid/retry', (req, res) => {
  const v = store.getVariant(req.params.id, req.params.vid);
  if (!v) return res.status(404).json({ error: 'Varyant bulunamadı' });
  pipeline.retryVariant(req.params.id, req.params.vid);
  res.json({ ok: true });
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
