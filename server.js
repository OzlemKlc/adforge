// server.js — AdForge yerel sunucu (Express + fal.ai REST).
// Marka: urun fotografi + brief -> 20 UGC varyanti + performans raporu.

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;
// FAL_KEY yoksa sunucu yine de acilir — arayüz onizlenebilir (ONIZLEME MODU).
// Sadece gercek uretim cagrilari (upload/produce) anahtar ister.
const PREVIEW = !FAL_KEY;
if (PREVIEW) {
  console.warn('\n[ÖNİZLEME] FAL_KEY ayarli degil. Arayüz acilir ama uretim yapilamaz.');
  console.warn('Uretim icin: .env.example -> .env kopyala, FAL_KEY yapistir, yeniden baslat.\n');
}

// Uretim rotalarini koruyan ara katman.
function requireKey(req, res, next) {
  if (PREVIEW) return res.status(400).json({ error: 'fal.ai anahtarı eklenmedi (önizleme modu). .env içine FAL_KEY ekleyip sunucuyu yeniden başlat.' });
  next();
}

const store = require('./lib/store');
const fal = require('./lib/fal');
const { estimateCampaign } = require('./lib/cost');
const { listStyles, defaultStyle } = require('./lib/styles');
const { listAvatars } = require('./lib/avatars');
const { LEVELS } = require('./lib/models');
const { listEngines, DEFAULT_ENGINE } = require('./lib/engines');
const { listScorers, DEFAULT_SCORER } = require('./lib/scorers');
const { llmAvailable } = require('./lib/llm');
const pipeline = require('./lib/pipeline');
const demo = require('./lib/demo');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: store.UPLOADS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

// --- meta & saglik ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, falKey: FAL_KEY ? 'present' : 'missing', preview: PREVIEW, llm: llmAvailable() });
});

app.get('/api/meta', (req, res) => {
  res.json({
    styles: listStyles().map((s) => ({ id: s.id, label: s.label, desc: s.desc, isDefault: !!s.isDefault })),
    avatars: listAvatars().map((a) => ({ id: a.id, label: a.label, energy: a.energy })),
    levels: Object.entries(LEVELS).map(([id, l]) => ({ id, label: l.label, pricePerSec: l.pricePerSec, family: l.family })),
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

// --- urun gorseli yukle ---
app.post('/api/upload', requireKey, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
    const url = await fal.upload(req.file.path, req.file.mimetype, req.file.originalname);
    fs.unlinkSync(req.file.path);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- kampanya olustur + uretimi baslat ---
app.post('/api/campaigns', requireKey, (req, res) => {
  try {
    const b = req.body || {};
    const product = (b.product || '').trim();
    if (!product) return res.status(400).json({ error: 'Ürün/marka zorunlu.' });

    const config = {
      avatars: clampInt(b.avatars, 1, 8, 2),
      hooks: clampInt(b.hooks, 1, 8, 5),
      styles: Array.isArray(b.styles) && b.styles.length ? b.styles : [defaultStyle().id],
      level: b.level || 'standart',
      duration: b.duration || '8s',
      engine: b.engine || DEFAULT_ENGINE,
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
  console.log(`  fal.ai: ${FAL_KEY ? 'bağlı ✓' : 'EKSİK (önizleme modu)'}   LLM (hook/skor): ${llmAvailable() ? 'açık (Anthropic)' : 'şablon modu'}\n`);
  if (!PREVIEW) pipeline.resumePending();
});
