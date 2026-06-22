// lib/store.js — Kampanya/varyant veri modeli (JSON dosya tabanli).
//
// Veri modeli:
//   Campaign { id, createdAt, brand, brief, config, productImageUrl,
//              status, cost, variants[], report }
//   Variant  { id, avatarId, hookId, hook, sceneImageUrl, status,
//              endpoint, requestId, statusUrl, responseUrl,
//              videoUrl, subtitledUrl, score, error }
//
// Her kampanya ayri dosyada (data/campaigns/<id>.json). Varyant guncellemeleri
// es zamanli poll worker'lardan gelir; yaris kosulunu onlemek icin tum mutasyonlar
// SENKRON oku-degistir-yaz (arada await yok -> Node event loop'unda atomik).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CAMP_DIR = path.join(DATA_DIR, 'campaigns');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

function ensureDirs() {
  for (const d of [DATA_DIR, CAMP_DIR, UPLOADS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
ensureDirs();

const newId = (prefix = '') => prefix + crypto.randomBytes(7).toString('hex');
const fileFor = (id) => path.join(CAMP_DIR, `${id}.json`);
const nowISO = () => new Date().toISOString();

function readCampaign(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

function writeCampaign(c) {
  const tmp = fileFor(c.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, fileFor(c.id)); // atomik degisim
  return c;
}

function createCampaign(data) {
  const id = newId('cmp_');
  const c = {
    id,
    createdAt: nowISO(),
    status: 'planning',
    brand: data.brand || { name: '', language: 'tr' },
    brief: data.brief || {},
    config: data.config || {},
    productImageUrl: data.productImageUrl || null,
    cost: data.cost || { estimated: null, actual: 0 },
    variants: [],
    report: null,
  };
  return writeCampaign(c);
}

function listCampaigns() {
  if (!fs.existsSync(CAMP_DIR)) return [];
  return fs
    .readdirSync(CAMP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CAMP_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Kampanya govdesini patch'le (sig birlestirme).
function updateCampaign(id, patch) {
  const c = readCampaign(id);
  if (!c) return null;
  Object.assign(c, patch);
  return writeCampaign(c);
}

function addVariants(id, variants) {
  const c = readCampaign(id);
  if (!c) return null;
  c.variants.push(...variants);
  return writeCampaign(c);
}

// Tek bir varyanti patch'le — SENKRON oku-degistir-yaz (yaris-guvenli).
function updateVariant(campaignId, variantId, patch) {
  const c = readCampaign(campaignId);
  if (!c) return null;
  const v = c.variants.find((x) => x.id === variantId);
  if (!v) return null;
  Object.assign(v, patch);
  writeCampaign(c);
  return v;
}

function getVariant(campaignId, variantId) {
  const c = readCampaign(campaignId);
  return c ? c.variants.find((x) => x.id === variantId) || null : null;
}

function deleteCampaign(id) {
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

// Acik (in-flight) durumdaki kampanya/varyantlari say — restart sonrasi resume icin.
const IN_FLIGHT = new Set(['composing', 'animating', 'subtitling', 'scoring', 'pending']);
function pendingVariants() {
  const out = [];
  for (const c of listCampaigns()) {
    for (const v of c.variants || []) {
      if (IN_FLIGHT.has(v.status)) out.push({ campaignId: c.id, variantId: v.id });
    }
  }
  return out;
}

module.exports = {
  DATA_DIR, CAMP_DIR, UPLOADS_DIR,
  newId, nowISO,
  createCampaign, readCampaign, listCampaigns, writeCampaign,
  updateCampaign, addVariants, updateVariant, getVariant, deleteCampaign,
  pendingVariants,
};
