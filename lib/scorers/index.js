// lib/scorers/index.js — SKORLAYICI REGISTRY'si (genisleme noktasi #4).
//
// Bir skorlayici su arayüzü saglar:
//   id, label: {tr,en}, source: 'predicted' | 'platform'
//   async score({ variant, campaign }) -> { value:0-100, breakdown, reason, source }
//
// Asamali plan (kullanici tercihi: "ikisi birden"):
//   v1: 'predicted' (AI tahmini) -> simdi aktif
//   v2: 'platform'  (Meta/TikTok gercek CTR/donusum) -> ayni arayüz, lib/scorers/platform.js
//       eklenince variant.score gercek veriyle GUNCELLENIR (ayni alan).

const predicted = require('./predicted');
const heuristic = require('./heuristic');
// const platform = require('./platform'); // v2: gercek reklam platformu verisi

const SCORERS = {
  [predicted.id]: predicted,
  [heuristic.id]: heuristic,
  // [platform.id]: platform,
};

// OpenAI anahtari varsa AI tahmini, yoksa kural tabanli yerel skor (API'siz).
const DEFAULT_SCORER = process.env.OPENAI_API_KEY ? predicted.id : heuristic.id;

const getScorer = (id) => SCORERS[id] || SCORERS[DEFAULT_SCORER];
const listScorers = () => Object.values(SCORERS).map((s) => ({ id: s.id, label: s.label, source: s.source }));

module.exports = { SCORERS, DEFAULT_SCORER, getScorer, listScorers };
