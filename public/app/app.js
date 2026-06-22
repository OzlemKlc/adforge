// AdForge dashboard frontend

const $ = (id) => document.getElementById(id);
const els = {
  health: $('health'), brandName: $('brandName'), language: $('language'),
  product: $('product'), benefit: $('benefit'), audience: $('audience'), tone: $('tone'),
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
  pending: 'Sırada', composing: 'Sahne', animating: 'Video', subtitling: 'Altyazı',
  scoring: 'Skor', completed: 'Hazır', partial: 'Kısmi', rejected: 'Reddedildi',
  mcp_error: 'fal hazır, çekilemedi', error: 'Hata',
};
const ANGLE_LABEL = {
  curiosity: 'merak', testimonial: 'itiraf', pain: 'sıkıntı', bold_result: 'iddia',
  social_proof: 'sosyal kanıt', mistake: 'hata', question: 'soru', demo: 'demo', problem: 'problem',
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
  updateVariantCount();
  updateCost();
  refreshCampaigns();
  setInterval(refreshCampaigns, 5000);
}

async function checkHealth() {
  try {
    const j = await (await fetch('/api/health')).json();
    if (j.falKey === 'present') {
      els.health.textContent = `fal.ai bağlı ✓ · hook/skor: ${j.llm ? 'LLM' : 'şablon'}`;
      els.health.className = 'health ok';
    } else {
      els.health.textContent = '● Önizleme modu — fal.ai anahtarı yok (üretim kapalı, .env\'e FAL_KEY ekle)';
      els.health.className = 'health bad';
    }
  } catch { els.health.textContent = 'sunucu yok'; els.health.className = 'health bad'; }
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

function buildLevels() {
  els.level.innerHTML = '';
  META.levels.filter((l) => l.id !== 'uzun').forEach((l) => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = `${l.label.tr} ($${l.pricePerSec}/sn)`;
    if (l.id === 'standart') o.selected = true;
    els.level.appendChild(o);
  });
}

function buildEngines() {
  els.engine.innerHTML = '';
  META.engines.forEach((e) => {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.label.tr || e.label.en;
    if (e.id === META.defaults.engine) o.selected = true;
    els.engine.appendChild(o);
  });
}

function bindEvents() {
  ['change'].forEach((ev) => {
    [els.avatars, els.hooks].forEach((s) => s.addEventListener(ev, () => { updateVariantCount(); updateCost(); }));
    [els.level, els.duration].forEach((s) => s.addEventListener(ev, updateCost));
    els.language.addEventListener(ev, () => { buildStyles(); });
  });
  els.image.addEventListener('change', onUpload);
  els.produceBtn.addEventListener('click', onProduce);
  els.demoBtn.addEventListener('click', onDemo);
}

async function onDemo() {
  els.produceMsg.textContent = ''; els.produceMsg.className = 'msg';
  els.demoBtn.disabled = true; els.demoBtn.textContent = 'Demo oluşturuluyor…';
  try {
    const body = {
      brandName: els.brandName.value.trim(), language: els.language.value,
      product: els.product.value.trim(), benefit: els.benefit.value.trim(),
      styles: [...selectedStyles],
    };
    const j = await (await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.campaignId) {
      els.produceMsg.className = 'msg success';
      els.produceMsg.textContent = 'Demo kampanyası hazır (20 örnek varyant + rapor). Sağ panelde.';
      activeCampaignId = j.campaignId;
      await refreshCampaigns();
      loadDetail(j.campaignId);
    } else { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = j.error || 'Hata'; }
  } catch (e) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = e.message; }
  finally { els.demoBtn.disabled = false; els.demoBtn.textContent = '✨ Demo kampanyası oluştur (anahtarsız)'; }
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
    els.costBreakdown.textContent = `${j.variants} varyant · sahne $${j.breakdown.compose} + video $${j.breakdown.video} + altyazı $${j.breakdown.subtitle} · ~$${j.perVariant}/varyant`;
  } catch {}
}

async function onUpload() {
  const f = els.image.files[0];
  if (!f) { uploadedImageUrl = null; els.imageStatus.textContent = ''; return; }
  els.imageStatus.textContent = 'Yükleniyor…';
  const fd = new FormData(); fd.append('file', f);
  try {
    const j = await (await fetch('/api/upload', { method: 'POST', body: fd })).json();
    if (j.url) { uploadedImageUrl = j.url; els.imageStatus.textContent = 'Yüklendi ✓'; }
    else els.imageStatus.textContent = 'Hata: ' + (j.error || '?');
  } catch (e) { els.imageStatus.textContent = 'Hata: ' + e.message; }
}

async function onProduce() {
  els.produceMsg.textContent = ''; els.produceMsg.className = 'msg';
  const product = els.product.value.trim();
  if (!product) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = 'Ürün zorunlu.'; return; }
  const n = (+els.avatars.value) * (+els.hooks.value);
  if (!confirm(`${n} varyant üretilecek. Tahmini maliyet ${els.costTotal.textContent}. Onaylıyor musun?`)) return;

  els.produceBtn.disabled = true; els.produceBtn.textContent = 'Başlatılıyor…';
  try {
    const body = {
      brandName: els.brandName.value.trim(), language: els.language.value,
      product, benefit: els.benefit.value.trim(), audience: els.audience.value.trim(), tone: els.tone.value.trim(),
      styles: [...selectedStyles], avatars: +els.avatars.value, hooks: +els.hooks.value,
      level: els.level.value, duration: els.duration.value, engine: els.engine.value,
      productImageUrl: uploadedImageUrl,
    };
    const j = await (await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (j.campaignId) {
      els.produceMsg.className = 'msg success';
      els.produceMsg.textContent = `Kampanya başladı (${n} varyant). Sağ panelde takip et.`;
      activeCampaignId = j.campaignId;
      await refreshCampaigns();
      loadDetail(j.campaignId);
    } else { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = j.error || 'Hata'; }
  } catch (e) { els.produceMsg.className = 'msg error'; els.produceMsg.textContent = e.message; }
  finally { els.produceBtn.disabled = false; els.produceBtn.textContent = 'Kampanyayı üret'; }
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
      ${c.topScore != null ? `<b style="color:var(--accent-2)">${c.topScore}</b>` : ''}
      <span class="del" data-del="${c.id}">✕</span>
    </div>`;
  }).join('') || '<small class="hint">Henüz kampanya yok.</small>';

  els.campList.querySelectorAll('.camp-tab').forEach((t) => {
    t.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      activeCampaignId = t.dataset.id; refreshCampaigns(); loadDetail(t.dataset.id);
    });
  });
  els.campList.querySelectorAll('[data-del]').forEach((d) => {
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Kampanyayı sil?')) return;
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
      <div class="progress">Üretiliyor… ${done}/${total} varyant hazır
        <div class="bar"><span style="width:${pct}%"></span></div>
      </div>
      <div class="summary" style="color:var(--muted)">Tüm varyantlar bittiğinde sıralama ve kazanan burada görünecek.</div>`;
    return;
  }
  const byId = Object.fromEntries(c.variants.map((v) => [v.id, v]));
  els.report.classList.remove('hidden');
  els.report.innerHTML = `<h3>Performans raporu ${r.scorer === 'predicted' ? '· AI tahmini' : ''}</h3>
    <div class="summary">${esc(r.summary || '')}</div>
    ${r.ranked.slice(0, 5).map((x) => {
      const v = byId[x.variantId] || {};
      return `<div class="rank ${x.rank === 1 ? 'top1' : ''}">
        <span class="n">${x.rank}</span>
        <span>${esc((v.hook && v.hook.hookLine) || ANGLE_LABEL[x.angle] || x.angle || '')}</span>
        <span class="score">${x.value}</span>
      </div>`;
    }).join('')}`;
}

function renderVariants(c) {
  const winnerId = c.report?.ranked?.[0]?.variantId;
  if (!c.variants.length) {
    els.variants.innerHTML = `<div class="empty">Hook'lar hazırlanıyor…</div>`;
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
        </div>
        <span class="vstatus ${v.status}">${STATUS_LABEL[v.status] || v.status}</span>
      </div>
      ${v.error ? `<div class="verror">${esc(v.error)}</div>` : ''}
      <div class="vactions">
        ${url ? `<a href="${url}" target="_blank">Aç</a><a href="${url}" download="adforge-${v.id}.mp4">İndir</a>` : ''}
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
