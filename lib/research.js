// lib/research.js — PAZAR ARASTIRMASI GIRDISI (rakip reklam -> kanitlanmis acilar).
//
// AdForge'un farki uretim degil, "arastirma -> hook -> test -> ogrenme" dongusu.
// Bu modul dongunun ilk halkasi: piyasada UZUN SURE yayinda kalan (yani para kazandiran)
// rakip reklamlarin hook'larini okur, hangi psikolojik acilari kullandigini cikarir ve
// planner'a "once bu acilari dene" sinyali verir.
//
// Kabul edilen girdiler (hepsi ayni normalize sekle indirgenir):
//   - Duz metin: her reklam ayri satirda ya da bos satirla ayrilmis paragraflarda
//   - Winning Product Finder arama ciktisi: { items: [{ adCopy, winningScore, daysActive }] }
//   - Winning Product Finder UGC brifi: { hookOptions: [{text}], signals: { winningScore } }
//   - Dizi: string[] ya da yukaridaki nesnelerin dizisi
//
// Deterministik, API'siz. LLM varsa planner bu ozeti prompt'a referans olarak ekler.

// Kural -> AdForge acisi (lib/planner.js ANGLES anahtarlariyla ayni).
// Turkce + Ingilizce; kucuk harfe cevirme tr-TR ile (I/ı sorunu).
// Kisa kokler kelime sinirli (\bsır\b): "sırt" ya da "zorunlu" yanlis pozitif vermesin.
const ANGLE_RULES = [
  { angle: 'question', test: (t, first) => /\?/.test(first) },
  { angle: 'pain', test: (t) => /(ağrı|kabus|bıktın|bıktıysan|yoruldun|unutuyor|israf|derdi|sorun|\bzor\b|pain|tired of|struggl|annoying|sick of)/.test(t) },
  { angle: 'mistake', test: (t) => /(hata|yanlış|keşke|bilseydim|yapma|mistake|wrong|wish i knew|stop doing)/.test(t) },
  { angle: 'curiosity', test: (t) => /(kimse söylemiyor|kimse bilmiyor|\bsır\b|sırrı|gizli|bunu bilmeden|nobody talks|no one tells|secret|hidden|before you buy)/.test(t) },
  { angle: 'bold_result', test: (t) => /(son ver|elveda|devrim|vazgeçilmez|%\s*\d+|\d+\s*(dakika|dk|gün|hafta|saat|kat|minutes?|days?|weeks?|x)\b|say goodbye|game[- ]?changer|results? in)/.test(t) },
  { angle: 'social_proof', test: (t) => /(favorisi|en çok satan|binlerce|herkes|viral|bir numara|best[- ]?seller|thousands|everyone|reviews?|5 yıldız|sold out)/.test(t) },
  { angle: 'testimonial', test: (t) => /(kullanıyorum|denedim|aldım ve|i've been using|i tried|i bought|my honest)/.test(t) },
  { angle: 'demo', test: (t) => /(tek hareket|tek elle|tek tuş|nasıl çalışıyor|göstereyim|dokunmadan|taşınabilir|anında|watch this|let me show|how it works|one[- ]click|instantly)/.test(t) },
];

// Hem Turkce hem Ingilizce kucuk harf: tr-TR "I"yi noktasiz "ı" yapar ("I've" -> "ı've"),
// bu yuzden Ingilizce kaliplar icin standart kucuk harf de eklenir.
const lower = (s) => {
  const str = String(s || '');
  return `${str.toLocaleLowerCase('tr-TR')}\n${str.toLowerCase()}`;
};

function firstSentence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^[^.!?]*[.!?]?/);
  return (m ? m[0] : t).trim();
}

/** Tek reklam metninin acilarini dondurur (sirali, tekrarsiz). */
function detectAngles(text) {
  const opener = firstSentence(text);
  if (!opener) return [];
  const t = lower(text);
  return ANGLE_RULES.filter((r) => r.test(t, opener)).map((r) => r.angle);
}

// Agirlik: WPF skoru varsa 0..1 (skor/100), yoksa yayinda kalma suresi (365 gun = 1),
// hicbiri yoksa 1. Boylece "60 gundur yayinda" olan reklam "2 gunluk" reklamdan agir basar.
function weightOf(obj) {
  const score = Number(obj?.winningScore ?? obj?.signals?.winningScore);
  if (Number.isFinite(score) && score > 0) return Math.min(score, 100) / 100;
  const days = Number(obj?.daysActive ?? obj?.signals?.daysActive);
  if (Number.isFinite(days) && days > 0) return Math.min(days, 365) / 365;
  return 1;
}

/** Her turlu girdiyi [{ text, weight }] listesine indirger. */
function normalizeInput(input) {
  if (input == null || input === '') return [];

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^[[{]/.test(trimmed)) {
      try {
        return normalizeInput(JSON.parse(trimmed));
      } catch {
        // JSON degilse duz metin gibi devam et
      }
    }
    const blocks = trimmed.includes('\n\n') ? trimmed.split(/\n\s*\n/) : trimmed.split(/\n/);
    return blocks.map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b.length >= 8).map((text) => ({ text, weight: 1 }));
  }

  if (Array.isArray(input)) return input.flatMap((x) => normalizeInput(x));

  if (typeof input === 'object') {
    if (Array.isArray(input.items)) return normalizeInput(input.items); // WPF arama ciktisi
    if (input.ugcBrief) return normalizeInput(input.ugcBrief); // WPF urun (brif ekli)
    if (input.adCopy) return [{ text: String(input.adCopy), weight: weightOf(input) }];
    if (Array.isArray(input.hookOptions)) {
      // WPF UGC brifi: yalnizca 'original' hook gercek reklamdan gelir; digerleri turetilmis
      const orig = input.hookOptions.find((h) => h && h.type === 'original') || input.hookOptions[0];
      return orig && orig.text ? [{ text: String(orig.text), weight: weightOf(input) }] : [];
    }
    if (input.text) return [{ text: String(input.text), weight: weightOf(input) }];
  }
  return [];
}

/**
 * Arastirma ozetini cikarir.
 * @returns {{ total:number, angles:Array<{angle,count,weight,share}>, references:Array<{angle,opener,weight}> }}
 */
function analyzeResearch(input, { maxReferences = 8 } = {}) {
  const entries = normalizeInput(input).slice(0, 200);
  const acc = {};
  const references = [];
  for (const e of entries) {
    const angles = detectAngles(e.text);
    for (const a of angles) {
      acc[a] = acc[a] || { count: 0, weight: 0 };
      acc[a].count += 1;
      acc[a].weight += e.weight;
    }
    if (angles.length) references.push({ angle: angles[0], angles, opener: firstSentence(e.text), weight: e.weight });
  }
  const total = entries.length;
  const angles = Object.entries(acc)
    .map(([angle, v]) => ({
      angle,
      count: v.count,
      weight: Math.round(v.weight * 100) / 100,
      share: total ? Math.round((v.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.angle.localeCompare(b.angle));
  references.sort((a, b) => b.weight - a.weight);
  return { total, angles, references: references.slice(0, maxReferences) };
}

/** Planner icin aci sirasi: once kanitlanmis acilar, sonra geri kalanlar. */
function orderAngles(allAngles, research) {
  const proven = (research?.angles || []).map((a) => a.angle).filter((a) => allAngles.includes(a));
  return [...proven, ...allAngles.filter((a) => !proven.includes(a))];
}

module.exports = { analyzeResearch, normalizeInput, detectAngles, orderAngles, firstSentence, ANGLE_RULES };
