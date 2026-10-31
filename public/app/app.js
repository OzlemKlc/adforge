// AdForge dashboard frontend

const $ = (id) => document.getElementById(id);
const els = {
  health: $('health'), brandName: $('brandName'), language: $('language'),
  product: $('product'), benefit: $('benefit'), audience: $('audience'), tone: $('tone'),
  research: $('research'), researchPreview: $('researchPreview'),
  image: $('image'), imageStatus: $('imageStatus'), styles: $('styles'),
  avatars: $('avatars'), hooks: $('hooks'), variantCount: $('variantCount'),
  level: $('level'), duration: $('duration'), engine: $('engine'),
  costTotal: $('costTotal'), costBreakdown: $('costBreakdown'),
  produceBtn: $('produceBtn'), demoBtn: $('demoBtn'), produceMsg: $('produceMsg'),
  campList: $('campList'), report: $('report'), variants: $('variants'),
};

let META = null;
let uploadedImageUrl = null;
let selectedStyles = new Set();
let activeCampaignId = null;
let detailTimer = null;

// Demo posterleri AYNI ürünün farklı reklam versiyonları gibi görünsün diye kadraj+ton varyasyonu
const TREAT = [
  { z: 1.06, p: '50% 42%', t: 'rgba(255,157,60,.12)' },
  { z: 1.20, p: '34% 30%', t: 'rgba(124,182,255,.12)' },
  { z: 1.12, p: '66% 56%', t: 'rgba(0,0,0,0)' },
  { z: 1.24, p: '44% 62%', t: 'rgba(255,150,190,.12)' },
  { z: 1.09, p: '62% 34%', t: 'rgba(74,222,128,.10)' },
  { z: 1.16, p: '40% 50%', t: 'rgba(255,67,38,.12)' },
];

const STATUS_LABEL = {
  pending: 'Queued', composing: 'Scene', animating: 'Video', subtitling: 'Captions',
  scoring: 'Scoring', completed: 'Ready', partial: 'Partial', rejected: 'Rejected',
  mcp_error: 'fal.ai ready, retrieval failed', error: 'Error',
};
const ANGLE_LABEL = {
  curiosity: 'curiosity', testimonial: 'testimonial', pain: 'pain point', bold_result: 'bold result',
  social_proof: 'social proof', mistake: 'mistake', question: 'question', demo: 'demo', problem: 'problem',
};

// ---------- init ----------
async function init() {
  await checkHealth();
  META = await (await fetch('/api/meta')).json();
  buildStyles();
  buildNumberSelect(els.avatars, 1, 8, META.defaults.avatars);
  buildNumberSelect(els.hooks, 1, 8, META.defaults.hooks);
  buildLevels();
  buildEngines();
  bindEvents();
  syncEngineUi();
  updateVariantCount();
  updateCost();
  refreshCampaigns();
  setInterval(refreshCampaigns, 5000);
}

async function checkHealth() {
  try {
    const j = await (await fetch('/api/health')).json();
    const fal = j.falKey === 'present' ? 'fal.ai connected ✓' : 'fal.ai unavailable (optional)';
    els.health.textContent = `local engine ready ✓ · ${fal} · hooks/scoring: ${j.llm ? 'LLM' : 'rules'}`;
    els.health.className = 'health ok';
  } catch { els.health.textContent = 'server unavailable'; els.health.className = 'health bad'; }
}

function buildStyles() {
  els.styles.innerHTML = '';
  META.styles.forEach((s) => {
    const lang = els.language.value;
    const chip = document.createElement('div');
    chip.className = 'chip' + (s.isDefault ? ' on' : '');
    chip.textContent = s.label[lang] || s.label.tr;
    chip.dataset.id = s.id;
    chip.title = (s.desc && (s.desc[lang] || s.desc.tr)) || '';
    if (s.isDefault) selectedStyles.add(s.id);
    chip.addEventListener('click', () => {
      if (selectedStyles.has(s.id)) { selectedStyles.delete(s.id); chip.classList.remove('on'); }
      else { selectedStyles.add(s.id); chip.classList.add('on'); }
      if (selectedStyles.size === 0) { selectedStyles.add(s.id); chip.classList.add('on'); } // en az 1
      updateCost();
    });
    els.styles.appendChild(chip);
  });
}

function buildNumberSelect(sel, lo, hi, def) {
  sel.innerHTML = '';
  for (let i = lo; i <= hi; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = i; if (i === def) o.selected = true;
    sel.appendChild(o);
  }
}

// motor <-> seviye <-> sure eslesmesi
// faceless: 15-30 sn ucretsiz; avatar: ~10-15 sn (gercek sure = ses uzunlugu); veo: 6-12 sn
const DURATIONS = {
  faceless: [['15s', '15 sec'], ['20s', '20 sec'], ['25s', '25 sec'], ['30s', '30 sec']],
  avatar: [['10s', '~10 sec (voice length)'], ['15s', '~15 sec (voice length)']],
  fal: [['6s', '6 sec'], ['8s', '8 sec'], ['10', '10 sec'], ['12', '12 sec']],
};
const ENGINE_LEVEL = { faceless: 'yerel', avatar: 'avatar' };
const ENGINE_DEFAULT_DUR = { faceless: '20s', avatar: '10s' };

function selectedEngine() {
  return (META.engines || []).find((x) => x.id === els.engine.value) || {};
}

function buildDurations(kind, selected) {
  els.duration.innerHTML = '';
  (DURATIONS[kind] || DURATIONS.fal).forEach(([val, txt]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = txt;
    if (val === selected) o.selected = true;
    els.duration.appendChild(o);
  });
}

function buildLevels() {
  els.level.innerHTML = '';
  META.levels.filter((l) => l.id !== 'uzun').forEach((l) => {
    const o = document.createElement('option');
    o.textContent = l.family === 'local'
      ? `${l.label.en || l.label.tr} — $0`
      : `${l.label.en || l.label.tr} ($${l.pricePerSec}/sec)`;
    o.value = l.id;
    els.level.appendChild(o);
  });
}

function buildEngines() {
  els.engine.innerHTML = '';
  META.engines.forEach((e) => {
    const o = document.createElement('option');
    o.value = e.id;
    const tag = e.free ? ' — free' : (e.available === false ? ' — requires FAL_KEY' : '');
    o.textContent = (e.label.en || e.label.tr) + tag;
    if (e.available === false) o.disabled = true;
    if (e.id === META.defaults.engine) o.selected = true;
    els.engine.appendChild(o);
  });
}

// motor secimine gore seviye + sure listelerini esle
function syncEngineUi() {
  const eng = selectedEngine();
  if (ENGINE_LEVEL[eng.id]) {
    els.level.value = ENGINE_LEVEL[eng.id];
    buildDurations(eng.id, ENGINE_DEFAULT_DUR[eng.id]);
  } else {
    const dedicated = Object.values(ENGINE_LEVEL);
    if (dedicated.includes(els.level.value) || !els.level.value) els.level.value = 'standart';
    buildDurations('fal', '8s');
  }
  updateCost();
}

function bindEvents() {
  ['change'].forEach((ev) => {
    [els.avatars, els.hooks].forEach((s) => s.addEventListener(ev, () => { updateVariantCount(); updateCost(); }));
    els.duration.addEventListener(ev, updateCost);
    els.level.addEventListener(ev, () => {
      // seviyenin adanmis motoru varsa ona gec; yoksa kullanilabilir kuyruk motoruna (veo)
      const lvl = META.levels.find((l) => l.id === els.level.value) || {};
      const target = lvl.engine
        ? META.engines.find((e) => e.id === lvl.engine)
        : META.engines.find((e) => !ENGINE_LEVEL[e.id] && e.available !== false);
      if (target && els.engine.value !== target.id) els.engine.value = target.id;
      syncEngineUi();
    });
    els.engine.addEventListener(ev, syncEngineUi);
    els.language.addEventListener(ev, () => { buildStyles(); });
  });
  els.image.addEventListener('change', onUpload);
  let researchTimer = null;
  els.research.addEventListener('input', () => {
    clearTimeout(researchTimer);
    researchTimer = setTimeout(previewResearch, 400);
  });
  els.produceBtn.addEventListener('click', onProduce);
  els.demoBtn.addEventListener('click', onDemo);
}

async function onDemo() {
  els.produceMsg.textContent = ''; els.produceMsg.className = 'msg';
  els.demoBtn.disabled = true; els.demoBtn.textContent = 'Creating demo…';
  try {
    const body = {
      brandName: els.brandName.value.trim(), language: els.language.value,
      product: els.product.value.trim(), benefit: els.benefit.value.trim(),
      styles: [...selectedStyles],
      research: els.research.value.trim() || undefined,
    };
    const j = await (await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.campaignId) {
      els.produceMsg.className = 'msg success';
      els.produceMsg.textContent = 'Demo campaign ready (20 sample variants plus report). See the right panel.';
      activeCampaignId = j.campaignId;
      await refreshCampaigns();
      loadDetail(j.campaignId);
    } else { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = j.error || 'Hata'; }
  } catch (e) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = e.message; }
  finally { els.demoBtn.disabled = false; els.demoBtn.textContent = '✨ Create demo campaign (no API key)'; }
}

function updateVariantCount() {
  els.variantCount.textContent = (+els.avatars.value) * (+els.hooks.value);
}

async function updateCost() {
  const q = new URLSearchParams({
    avatars: els.avatars.value, hooks: els.hooks.value,
    styleCount: Math.max(1, selectedStyles.size), level: els.level.value, duration: els.duration.value,
  });
  try {
    const j = await (await fetch('/api/cost?' + q)).json();
    els.costTotal.textContent = `$${j.total.toFixed(2)}`;
    els.costBreakdown.textContent = `${j.variants} variants · scene $${j.breakdown.compose} + video $${j.breakdown.video} + captions $${j.breakdown.subtitle} · ~$${j.perVariant}/variant`;
  } catch {}
}

async function onUpload() {
  const f = els.image.files[0];
  if (!f) { uploadedImageUrl = null; els.imageStatus.textContent = ''; return; }
  els.imageStatus.textContent = 'Uploading…';
  const fd = new FormData(); fd.append('file', f);
  try {
    const j = await (await fetch('/api/upload', { method: 'POST', body: fd })).json();
    if (j.url) { uploadedImageUrl = j.url; els.imageStatus.textContent = 'Uploaded ✓'; }
    else els.imageStatus.textContent = 'Hata: ' + (j.error || '?');
  } catch (e) { els.imageStatus.textContent = 'Hata: ' + e.message; }
}

async function onProduce() {
  els.produceMsg.textContent = ''; els.produceMsg.className = 'msg';
  const product = els.product.value.trim();
  if (!product) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = 'Product is required.'; return; }
  const n = (+els.avatars.value) * (+els.hooks.value);
  const costNote = selectedEngine().free
    ? `${n} variants will use the local engine (free — about 1–2 CPU minutes per variant). Continue?`
    : `${n} variants will be generated. Estimated cost: ${els.costTotal.textContent}. Continue?`;
  if (!confirm(costNote)) return;

  els.produceBtn.disabled = true; els.produceBtn.textContent = 'Starting…';
  try {
    const body = {
      brandName: els.brandName.value.trim(), language: els.language.value,
      product, benefit: els.benefit.value.trim(), audience: els.audience.value.trim(), tone: els.tone.value.trim(),
      styles: [...selectedStyles], avatars: +els.avatars.value, hooks: +els.hooks.value,
      level: els.level.value, duration: els.duration.value, engine: els.engine.value,
      productImageUrl: uploadedImageUrl,
      research: els.research.value.trim() || undefined,
    };
    const j = await (await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.campaignId) {
      els.produceMsg.className = 'msg success';
      els.produceMsg.textContent = `Campaign started (${n} variants). Follow progress in the right panel.`;
      activeCampaignId = j.campaignId;
      await refreshCampaigns();
      loadDetail(j.campaignId);
    } else { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = j.error || 'Hata'; }
  } catch (e) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = e.message; }
  finally { els.produceBtn.disabled = false; els.produceBtn.textContent = 'Generate campaign'; }
}

// ---------- rakip arastirmasi onizleme ----------
async function previewResearch() {
  const text = els.research.value.trim();
  if (!text) { els.researchPreview.innerHTML = ''; return; }
  try {
    const r = await (await fetch('/api/research/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ research: text }) })).json();
    if (!r.total) { els.researchPreview.innerHTML = '<span class="hint">No recognizable ad copy yet.</span>'; return; }
    els.researchPreview.innerHTML = `<span class="hint">${r.total} ads · evidence-backed angles (tested first):</span> ` +
      r.angles.slice(0, 5).map((a) => `<span class="achip">${esc(ANGLE_LABEL[a.angle] || a.angle)} · ${a.count}</span>`).join('');
  } catch { els.researchPreview.innerHTML = ''; }
}

// ---------- kampanya listesi ----------
async function refreshCampaigns() {
  let camps;
  try { camps = await (await fetch('/api/campaigns')).json(); } catch { return; }
  if (!activeCampaignId && camps.length) activeCampaignId = camps[0].id;
  els.campList.innerHTML = camps.map((c) => {
    const dot = c.status === 'completed' ? 'completed' : c.status === 'error' ? 'error' : 'producing';
    return `<div class="camp-tab ${c.id === activeCampaignId ? 'on' : ''}" data-id="${c.id}">
      <span class="dot ${dot}"></span>
      <span>${esc(c.product || 'Kampanya')} <small>(${c.counts.done}/${c.counts.total})</small></span>
      ${c.demo ? '<span style="font-size:9px;font-weight:700;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:0 4px">DEMO</span>' : ''}
      ${c.topScore != null ? `<b style="color:var(--accent-2)">${c.topScore}</b>` : ''}
      <span class="del" data-del="${c.id}">✕</span>
    </div>`;
  }).join('') || '<small class="hint">No campaigns yet.</small>';

  els.campList.querySelectorAll('.camp-tab').forEach((t) => {
    t.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      activeCampaignId = t.dataset.id; refreshCampaigns(); loadDetail(t.dataset.id);
    });
  });
  els.campList.querySelectorAll('[data-del]').forEach((d) => {
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this campaign?')) return;
      await fetch('/api/campaigns/' + d.dataset.del, { method: 'DELETE' });
      if (activeCampaignId === d.dataset.del) { activeCampaignId = null; els.variants.innerHTML = '<div class="empty">Kampanya silindi.</div>'; els.report.classList.add('hidden'); }
      refreshCampaigns();
    });
  });

  if (activeCampaignId) loadDetail(activeCampaignId, true);
}

// ---------- kampanya detayi ----------
async function loadDetail(id, quiet) {
  let c;
  try { c = await (await fetch('/api/campaigns/' + id)).json(); } catch { return; }
  if (!c || c.error) return;
  renderReport(c);
  renderVariants(c);

  // uretim suruyorsa kisa aralikla yenile
  clearTimeout(detailTimer);
  if (c.status === 'producing' || c.status === 'planning') {
    detailTimer = setTimeout(() => loadDetail(id, true), 4000);
  }
}

function renderReport(c) {
  const r = c.report;
  const done = c.variants.filter((v) => v.status === 'completed').length;
  const total = c.variants.length || (c.config.avatars * c.config.hooks);
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (!r || !r.ranked || !r.ranked.length) {
    els.report.classList.remove('hidden');
    els.report.innerHTML = `<h3>Performans raporu</h3>
      <div class="progress">Generating… ${done}/${total} variants ready
        <div class="bar"><span style="width:${pct}%"></span></div>
      </div>
      <div class="summary" style="color:var(--muted)">Ranking and the predicted winner will appear when all variants finish.</div>`;
    return;
  }
  const byId = Object.fromEntries(c.variants.map((v) => [v.id, v]));
  els.report.classList.remove('hidden');
  els.report.innerHTML = `<h3>Performans raporu ${r.scorer === 'predicted' ? '· AI tahmini' : ''}</h3>
    ${researchSummaryHTML(r.research)}
    <div class="summary">${esc(r.summary || '')}</div>
    ${r.ranked.slice(0, 5).map((x) => {
      const v = byId[x.variantId] || {};
      return `<div class="rank ${x.rank === 1 ? 'top1' : ''}">
        <span class="n">${x.rank}</span>
        <span>${esc((v.hook && v.hook.hookLine) || ANGLE_LABEL[x.angle] || x.angle || '')}</span>
        <span class="score">${x.value}</span>
      </div>`;
    }).join('')}
    ${learningHTML(r.learning, byId)}
    ${c.status === 'producing' || c.status === 'planning' ? '' : resultsFormHTML(c)}`;
  bindResultsForm(c);
}

// --- arastirma ozeti (rapor ustu) ---
function researchSummaryHTML(research) {
  if (!research || !research.angles || !research.angles.length) return '';
  return `<div class="research-sum">🔎 Evidence-backed angles from ${research.total} competitor ads: ${research.angles.slice(0, 5)
    .map((a) => `<span class="achip">${esc(ANGLE_LABEL[a.angle] || a.angle)} · ${a.count}</span>`).join('')}</div>`;
}

// --- ogrenme: gercek kazanan + tahmin isabeti ---
const BASIS_LABEL = { cpa: 'lowest CPA', conversionRate: 'highest conversion rate', ctr: 'highest CTR' };
function learningHTML(learning, byId) {
  if (!learning || !learning.realWinner) return '';
  const w = learning.realWinner;
  const v = byId[w.variantId] || {};
  const m = w.metrics || {};
  const pct = (x) => (x == null ? '—' : (x * 100).toFixed(2) + '%');
  return `<div class="learning ${learning.predictionMatched ? 'match' : 'miss'}">
    <b>Actual winner (${BASIS_LABEL[w.basis] || w.basis}):</b> ${esc((v.hook && v.hook.hookLine) || w.angle || '')}
    <div class="lm">CTR ${pct(m.ctr)} · Conversion ${pct(m.cvr)} · CPA ${m.cpa == null ? '—' : m.cpa}</div>
    <div class="lm">${learning.predictionMatched
      ? '✓ Prediction matched: the scorer selected this variant.'
      : '✗ Prediction differed. This result will update angle weights in future campaigns.'}</div>
  </div>`;
}

// --- gercek sonuc girisi (Meta/TikTok reklam yoneticisinden) ---
function resultsFormHTML(c) {
  const done = c.variants.filter((v) => v.status === 'completed');
  if (!done.length) return '';
  const n = (x) => (x == null ? '' : x);
  return `<details class="results">
    <summary>📊 Enter actual ad results <small class="hint">(learning loop)</small></summary>
    <p class="hint">Enter metrics from your ad manager. Low-impression variants are excluded; results update future campaign scoring.</p>
    <table class="rtable"><thead><tr><th>Hook</th><th>Impressions</th><th>Clicks</th><th>Conversions</th><th>Spend</th></tr></thead><tbody>
    ${done.map((v) => `<tr data-vid="${v.id}">
      <td title="${esc((v.hook && v.hook.hookLine) || '')}">${esc((v.hook && v.hook.hookLine) || '').slice(0, 48)}<div class="rav">${esc((v.avatarLabel && (v.avatarLabel[c.brand?.language || 'tr'] || v.avatarLabel.tr)) || v.avatarId || '')}</div></td>
      <td><input type="number" min="0" name="impressions" value="${n(v.real?.impressions)}"></td>
      <td><input type="number" min="0" name="clicks" value="${n(v.real?.clicks)}"></td>
      <td><input type="number" min="0" name="conversions" value="${n(v.real?.conversions)}"></td>
      <td><input type="number" min="0" step="0.01" name="spend" value="${n(v.real?.spend)}"></td>
    </tr>`).join('')}
    </tbody></table>
    <button type="button" id="saveResults" class="primary">Save results</button>
    <span id="resultsMsg" class="msg"></span>
  </details>`;
}

function bindResultsForm(c) {
  const btn = document.getElementById('saveResults');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const rows = [...els.report.querySelectorAll('tr[data-vid]')];
    const results = rows.map((tr) => {
      const val = (name) => tr.querySelector(`[name=${name}]`).value;
      return { variantId: tr.dataset.vid, impressions: val('impressions'), clicks: val('clicks'), conversions: val('conversions'), spend: val('spend') };
    }).filter((r) => r.impressions !== '');
    const msg = document.getElementById('resultsMsg');
    if (!results.length) { msg.className = 'msg error'; msg.textContent = 'Enter impressions for at least one variant.'; return; }
    btn.disabled = true;
    try {
      const j = await (await fetch(`/api/campaigns/${c.id}/results`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) })).json();
      if (j.error) throw new Error(j.error);
      await loadDetail(c.id, true);
    } catch (e) { msg.className = 'msg error'; msg.textContent = e.message; btn.disabled = false; }
  });
}

function renderVariants(c) {
  const winnerId = c.report?.ranked?.[0]?.variantId;
  if (!c.variants.length) {
    els.variants.innerHTML = `<div class="empty">Preparing hooks…</div>`;
    return;
  }
  const lang = c.brand?.language || 'tr';
  els.variants.innerHTML = c.variants.map((v) => {
    const url = v.subtitledUrl || v.videoUrl;
    const isWin = v.id === winnerId;
    const thumb = url
      ? `<video src="${url}" controls preload="metadata"></video>`
      : (v.isDemo && v.posterUrl)
        ? (() => { const t = TREAT[(v.treat || 0) % TREAT.length]; const kb = ((v.treat || 0) % 3) + 1; return `<img class="poster kb${kb}" src="${v.posterUrl}" alt="" style="object-position:${t.p}"><div class="ptint" style="background:${t.t}"></div><span class="demoTag">DEMO</span><span class="vdur">0:08</span>`; })()
        : `<span>${STATUS_LABEL[v.status] || v.status}…</span>`;
    const score = v.score && typeof v.score.value === 'number' ? `<span class="scoreBadge">${v.score.value}</span>` : '';
    const win = isWin ? `<span class="winFlag">★ KAZANAN</span>` : '';
    const avatarLabel = (v.avatarLabel && (v.avatarLabel[lang] || v.avatarLabel.tr)) || v.avatarId;
    return `<div class="vcard ${isWin ? 'win' : ''}">
      <div class="vthumb">${thumb}${score}${win}</div>
      <div class="vmeta">
        <div class="hookline">${esc((v.hook && v.hook.hookLine) || '')}</div>
        <div class="vtags">
          <span class="vtag">${esc(avatarLabel)}</span>
          <span class="vtag">${ANGLE_LABEL[v.hook?.angle] || v.hook?.angle || ''}</span>
          ${v.hook?.researchBacked ? `<span class="vtag research" title="${esc(v.hook.reference ? 'Reference: ' + v.hook.reference : 'Angle validated by competitor research')}">🔎 evidence-backed</span>` : ''}
        </div>
        ${v.real && v.real.impressions ? `<div class="vreal">CTR ${v.real.ctr == null ? '—' : (v.real.ctr * 100).toFixed(2) + '%'} · ${v.real.impressions} impressions${v.real.enoughData ? '' : ' · limited data'}</div>` : ''}
        <span class="vstatus ${v.status}">${STATUS_LABEL[v.status] || v.status}</span>
      </div>
      ${v.error ? `<div class="verror">${esc(v.error)}</div>` : ''}
      <div class="vactions">
        ${url ? `<a href="${url}" target="_blank">Open</a><a href="${url}" download="adforge-${v.id}.mp4">Download</a>` : ''}
        ${['error', 'rejected', 'mcp_error', 'partial'].includes(v.status) ? `<button data-retry="${v.id}">Yenile</button>` : ''}
      </div>
    </div>`;
  }).join('');

  els.variants.querySelectorAll('[data-retry]').forEach((b) => {
    b.addEventListener('click', async () => {
      await fetch(`/api/campaigns/${c.id}/variants/${b.dataset.retry}/retry`, { method: 'POST' });
      loadDetail(c.id, true);
    });
  });
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

init();
