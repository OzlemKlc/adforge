// lib/pipeline.js — KAMPANYA ORKESTRATORU.
//
// Akis (5 asama):
//   1) PLAN     brief -> N hook (planner)
//   2) COMPOSE  her distinct (avatar x style) -> sahne goseli (nano-banana), cache'li
//   3) ANIMATE  her varyant (avatar x hook) -> konusan video (motor.submit -> poll)
//   4) SUBTITLE her video -> TR/EN altyazi (sema-guvenli)
//   5) SCORE    her varyant -> tahmini skor; sonra rapor (siralama + kazanan)
//
// Hatalar varyant bazinda izole edilir; biri patlasa digerleri devam eder.
// Pahali ANIMATE isleri requestId ile persist edilir -> restart sonrasi resume,
// yeniden submit YOK (cifte ucret yok).

const store = require('./store');
const { generateHooks } = require('./planner');
const { pickAvatars } = require('./avatars');
const { getStyle } = require('./styles');
const { composeScene } = require('./compose');
const { getEngine, DEFAULT_ENGINE } = require('./engines');
const { addSubtitles } = require('./subtitle');
const { getScorer, DEFAULT_SCORER } = require('./scorers');
const { parseDur } = require('./cost');
const fal = require('./fal');

const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '4', 10);

// --- basit eszamanlilik sinirlayici ---
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// compose Promise cache (es zamanli ayni avatar+style icin tek uretim)
const composeCache = new Map(); // key: `${campaignId}:${avatarId}:${styleId}` -> Promise<url>

function composeKey(campaignId, avatarId, styleId) {
  return `${campaignId}:${avatarId}:${styleId}`;
}

// Sahne goselini al: once kardes varyantta var mi (store), sonra in-memory cache, sonra uret.
async function getOrComposeScene(campaignId, variant) {
  const key = composeKey(campaignId, variant.avatarId, variant.hook.styleId);

  // kardes varyant zaten kompoze ettiyse onu kullan (restart sonrasi da gecerli)
  const camp = store.readCampaign(campaignId);
  const sibling = (camp.variants || []).find(
    (v) => v.sceneImageUrl && v.avatarId === variant.avatarId && v.hook?.styleId === variant.hook.styleId
  );
  if (sibling) return sibling.sceneImageUrl;

  if (composeCache.has(key)) return composeCache.get(key);

  const p = composeScene({
    productImageUrl: camp.productImageUrl,
    avatarId: variant.avatarId,
    styleId: variant.hook.styleId,
    productNote: camp.brief?.product ? `The product is ${camp.brief.product}.` : '',
  }).finally(() => {
    // 5 sn sonra cache'ten dus (uzun kampanyalarda bellek sismesin)
    setTimeout(() => composeCache.delete(key), 5000);
  });
  composeCache.set(key, p);
  return p;
}

// Tek bir varyanti uctan uca isle. Hata firlatmaz; durumu store'a yazar.
async function runVariant(campaignId, variantId) {
  try {
    let camp = store.readCampaign(campaignId);
    let variant = camp.variants.find((v) => v.id === variantId);
    if (!variant) return;
    const language = camp.brand?.language === 'en' ? 'en' : 'tr';
    const level = camp.config?.level || 'standart';
    const durationSec = parseDur(camp.config?.duration || '8s');
    const engine = getEngine(variant.engine || camp.config?.engine || DEFAULT_ENGINE);

    // 1) COMPOSE
    if (!variant.sceneImageUrl) {
      store.updateVariant(campaignId, variantId, { status: 'composing', error: null });
      const sceneUrl = await getOrComposeScene(campaignId, variant);
      store.updateVariant(campaignId, variantId, { sceneImageUrl: sceneUrl });
    }

    // 2) ANIMATE (resume-aware)
    variant = store.getVariant(campaignId, variantId);
    let job;
    if (variant.requestId && variant.status === 'animating') {
      job = { endpoint: variant.endpoint, requestId: variant.requestId, statusUrl: variant.statusUrl, responseUrl: variant.responseUrl };
    } else if (!variant.videoUrl) {
      store.updateVariant(campaignId, variantId, { status: 'animating', error: null });
      job = await engine.submit({ sceneImageUrl: variant.sceneImageUrl, script: variant.hook.script, language, level, durationSec });
      store.updateVariant(campaignId, variantId, { engine: engine.id, endpoint: job.endpoint, requestId: job.requestId, statusUrl: job.statusUrl, responseUrl: job.responseUrl });
    }
    if (!variant.videoUrl) {
      const { body } = await fal.pollJob(job);
      const videoUrl = engine.extractVideoUrl(body);
      if (!videoUrl) {
        store.updateVariant(campaignId, variantId, { status: 'error', error: 'Video URL alınamadı.' });
        return;
      }
      store.updateVariant(campaignId, variantId, { videoUrl });
    }

    // 3) SUBTITLE (opsiyonel — config.subtitles=false ise atla)
    variant = store.getVariant(campaignId, variantId);
    if (camp.config?.subtitles !== false && !variant.subtitledUrl) {
      store.updateVariant(campaignId, variantId, { status: 'subtitling' });
      const { subtitledUrl, transcription } = await addSubtitles({ videoUrl: variant.videoUrl, language });
      store.updateVariant(campaignId, variantId, { subtitledUrl: subtitledUrl || null, transcription: transcription || null });
    }

    // 4) SCORE
    store.updateVariant(campaignId, variantId, { status: 'scoring' });
    const scorer = getScorer(camp.scorer || DEFAULT_SCORER);
    const score = await scorer.score({ variant: store.getVariant(campaignId, variantId), campaign: camp });
    store.updateVariant(campaignId, variantId, { score, status: 'completed' });
  } catch (e) {
    const kind = e instanceof fal.FalError ? e.kind : 'error';
    const statusMap = { rejected: 'rejected', mcp_error: 'mcp_error', auth: 'error', http: 'error' };
    store.updateVariant(campaignId, variantId, { status: statusMap[kind] || 'error', error: e.message });
  }
}

// Tum bekleyen varyantlari eszamanlilik siniriyla isle, sonra rapor uret.
async function runAll(campaignId) {
  const camp = store.readCampaign(campaignId);
  if (!camp) return;
  const limit = createLimiter(MAX_CONCURRENCY);
  const targets = camp.variants.filter((v) => v.status !== 'completed');
  await Promise.all(targets.map((v) => limit(() => runVariant(campaignId, v.id))));
  buildReport(campaignId);
  finalizeStatus(campaignId);
}

// PLAN + varyant insasi + uretim. Arka planda cagrilir (await edilmez).
async function produceCampaign(campaignId) {
  try {
    const camp = store.readCampaign(campaignId);
    if (!camp) return;
    store.updateCampaign(campaignId, { status: 'planning' });

    const cfg = camp.config || {};
    const styleIds = (cfg.styles && cfg.styles.length ? cfg.styles : ['samimi-itiraf']);
    const { hooks, source } = await generateHooks({
      product: camp.brief?.product,
      benefit: camp.brief?.benefit,
      brand: camp.brand?.name,
      audience: camp.brief?.audience,
      tone: camp.brief?.tone,
      language: camp.brand?.language,
      count: cfg.hooks || 4,
      styleIds,
    });

    const avatars = pickAvatars(cfg.avatars || 5, cfg.avatarIds);
    const variants = [];
    for (const hook of hooks) {
      for (const avatar of avatars) {
        variants.push({
          id: store.newId('var_'),
          avatarId: avatar.id,
          avatarLabel: avatar.label,
          hookId: hook.id,
          hook,
          engine: cfg.engine || DEFAULT_ENGINE,
          status: 'pending',
          sceneImageUrl: null,
          endpoint: null, requestId: null, statusUrl: null, responseUrl: null,
          videoUrl: null, subtitledUrl: null, transcription: null,
          score: null, error: null,
        });
      }
    }
    store.updateCampaign(campaignId, { plannedHooks: hooks, hookSource: source });
    store.addVariants(campaignId, variants);
    store.updateCampaign(campaignId, { status: 'producing' });

    await runAll(campaignId);
  } catch (e) {
    store.updateCampaign(campaignId, { status: 'error', error: e.message });
  }
}

// Skorlara gore siralama + kazanan + ozet.
function buildReport(campaignId) {
  const camp = store.readCampaign(campaignId);
  if (!camp) return;
  const scored = camp.variants
    .filter((v) => v.score && typeof v.score.value === 'number')
    .sort((a, b) => b.score.value - a.score.value);

  const ranked = scored.map((v, i) => ({
    rank: i + 1,
    variantId: v.id,
    value: v.score.value,
    angle: v.hook?.angle,
    styleId: v.hook?.styleId,
    avatarId: v.avatarId,
  }));

  let summary = null;
  if (scored.length) {
    const top = scored[0];
    const lang = camp.brand?.language === 'en' ? 'en' : 'tr';
    const styleLabel = getStyle(top.hook?.styleId).label[lang];
    summary = lang === 'en'
      ? `Top variant scored ${top.score.value}/100 — angle "${top.hook?.angle}", style "${styleLabel}", presenter "${top.avatarLabel?.en || top.avatarId}". Recommend scaling the top 3 and retiring the bottom.`
      : `En iyi varyant ${top.score.value}/100 — açı "${top.hook?.angle}", tarz "${styleLabel}", sunucu "${top.avatarLabel?.tr || top.avatarId}". İlk 3'ü ölçeklendirip alttakileri elemen önerilir.`;
  }

  store.updateCampaign(campaignId, {
    report: { generatedAt: store.nowISO(), ranked, summary, scorer: camp.scorer || DEFAULT_SCORER },
  });
}

function finalizeStatus(campaignId) {
  const camp = store.readCampaign(campaignId);
  if (!camp) return;
  const allDone = camp.variants.every((v) => ['completed', 'partial', 'rejected', 'mcp_error', 'error'].includes(v.status));
  const anyOk = camp.variants.some((v) => v.status === 'completed' || v.status === 'partial');
  if (allDone) store.updateCampaign(campaignId, { status: anyOk ? 'completed' : 'error' });
}

// Restart sonrasi yarim kalan varyantlari devam ettir.
function resumePending() {
  const pend = store.pendingVariants();
  if (!pend.length) return;
  console.log(`[pipeline] ${pend.length} yarim varyant resume ediliyor...`);
  const byCamp = {};
  for (const p of pend) (byCamp[p.campaignId] ||= []).push(p.variantId);
  for (const [campaignId, ids] of Object.entries(byCamp)) {
    const limit = createLimiter(MAX_CONCURRENCY);
    Promise.all(ids.map((id) => limit(() => runVariant(campaignId, id))))
      .then(() => { buildReport(campaignId); finalizeStatus(campaignId); })
      .catch(() => {});
  }
}

// Tek varyanti yeniden uret (kullanici "bunu yenile" derse).
function retryVariant(campaignId, variantId) {
  store.updateVariant(campaignId, variantId, {
    status: 'pending', error: null, requestId: null, endpoint: null, statusUrl: null, responseUrl: null, videoUrl: null, subtitledUrl: null,
  });
  runVariant(campaignId, variantId).then(() => { buildReport(campaignId); finalizeStatus(campaignId); });
}

module.exports = { produceCampaign, runAll, runVariant, resumePending, retryVariant, buildReport };
