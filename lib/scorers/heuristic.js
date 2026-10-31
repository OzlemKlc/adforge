// lib/scorers/heuristic.js — KURAL TABANLI SKORLAYICI (API'siz, ucretsiz).
//
// ANTHROPIC_API_KEY yokken varsayilan skorlayici. predicted.js'in heuristik cekirdegini
// yeniden kullanir (hook gucu / kisalik / CTA / netlik) ve uzerine yerel faceless
// motoru icin anlamli iki sinyal ekler:
//   durationFit  script uzunlugu hedef video suresine uyuyor mu (~0.45 sn/kelime)
//   audienceFit  hedef kitle metni <-> avatar/tarz eslesmesi (anahtar kelime tablosu)
//
// Cikti semasi predicted ile AYNI ({value, breakdown, reason, source}) -> rapor
// katmani (pipeline.buildReport) hicbir degisiklik istemez.

const predicted = require('./predicted');

const id = 'heuristic';
const label = { tr: 'Kural tabanlı skor (yerel)', en: 'Heuristic score (local)' };
const source = 'heuristic';

// hedef kitle metnindeki anahtar kelime -> uyumlu avatar/tarz id parcalari
const AUDIENCE_MATCH = [
  { re: /(genç|genc|üniversite|universite|gen-?z|student|young|teen)/i, avatar: /^genc-/, style: /(heyecanli-kesif|komik-eglenceli|sokak-roportaji)/ },
  { re: /(profesyonel|uzman|kurumsal|professional|expert|b2b)/i, avatar: /^olgun-/, style: /(uzman-tavsiyesi|luks-estetik)/ },
  { re: /(anne|baba|ebeveyn|çocuk|cocuk|parent|mom|dad|family|aile)/i, avatar: /(olgun-kadin-sicak|olgun-kadin-guvenilir)/, style: /(samimi-itiraf|problem-cozum)/ },
  { re: /(lüks|luks|premium|luxury|high-?end)/i, avatar: /^olgun-/, style: /luks-estetik/ },
  { re: /(spor|fitness|sağlık|saglik|wellness|fit|gym)/i, avatar: /genc-kadin-fit/, style: /(once-sonra|samimi-itiraf)/ },
];

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

async function score({ variant, campaign, learned }) {
  const base = predicted.heuristicScore({ variant, learned });
  const lang = campaign?.brand?.language === 'en' ? 'en' : 'tr';

  // --- durationFit: konusma suresi hedef sureye uyuyor mu ---
  const script = variant.hook?.script || '';
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const estSec = words * 0.45;
  const target = parseInt(String(campaign?.config?.duration || '15').replace('s', ''), 10) || 15;
  const ratio = estSec / target;
  let durationFit = 100;
  if (ratio > 1.4 || ratio < 0.3) durationFit = 55;
  else if (ratio > 1.15 || ratio < 0.5) durationFit = 78;

  // --- audienceFit: kitle metni <-> avatar/tarz eslesmesi ---
  const audience = campaign?.brief?.audience || '';
  let audienceFit = 75; // kitle belirtilmemisse notr
  if (audience) {
    audienceFit = 70;
    for (const m of AUDIENCE_MATCH) {
      if (!m.re.test(audience)) continue;
      const avatarOk = m.avatar.test(variant.avatarId || '');
      const styleOk = m.style.test(variant.hook?.styleId || '');
      if (avatarOk && styleOk) audienceFit = 100;
      else if (avatarOk || styleOk) audienceFit = Math.max(audienceFit, 85);
      else audienceFit = Math.min(audienceFit, 60);
      break;
    }
  }

  const value = clamp(Math.round(0.7 * base.value + 0.15 * durationFit + 0.15 * audienceFit));
  const breakdown = { ...base.breakdown, durationFit, audienceFit };
  const reason = lang === 'en'
    ? `Hook base ${base.value}. Duration fit ${durationFit} (~${Math.round(estSec)}s speech vs ${target}s target). Audience fit ${audienceFit}.`
    : `Hook taban ${base.value}. Süre uyumu ${durationFit} (~${Math.round(estSec)} sn konuşma / ${target} sn hedef). Kitle uyumu ${audienceFit}.`;

  return { value, breakdown, reason, source };
}

module.exports = { id, label, source, score };
