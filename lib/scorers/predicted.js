// lib/scorers/predicted.js — AI TAHMINI SKORLAYICI (v1).
//
// Her varyantin hook/script + tarz/avatar uyumunu 0-100 arasi tahmini bir
// "donusum potansiyeli" skoruna cevirir. LLM varsa OpenAI ile, yoksa heuristik.
// Cikti semasi 'platform' skorlayici (v2, gercek CTR) ile AYNI -> sonradan
// degerler gercek veriyle degistirilebilir.

const { llmAvailable, callLLM } = require('../llm');
const { getStyle } = require('../styles');
const { getAvatar } = require('../avatars');

const id = 'predicted';
const label = { tr: 'AI tahmini skor', en: 'AI predicted score' };
const source = 'predicted';

// Acilara gore dikkat-cekme taban agirligi (0-1).
const ANGLE_WEIGHT = {
  curiosity: 0.92, bold_result: 0.9, social_proof: 0.85, question: 0.82,
  mistake: 0.8, problem: 0.8, pain: 0.78, demo: 0.74, testimonial: 0.7,
};

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

// Aci agirligi kaynagi, oncelik sirasiyla:
//   1) learned  : markanin kendi gercek reklam sonuclarindan (lib/learnings.js)
//   2) research : aci rakip arastirmasinda kanitlanmis -> elle tablo + 0.05
//   3) default  : elle yazilmis ANGLE_WEIGHT tablosu
function angleWeight(hook, learned) {
  if (learned && typeof learned[hook.angle] === 'number') {
    return { weight: learned[hook.angle], weightSource: 'learned' };
  }
  const base = ANGLE_WEIGHT[hook.angle] ?? 0.75;
  if (hook.researchBacked) return { weight: Math.min(base + 0.05, 0.97), weightSource: 'research' };
  return { weight: base, weightSource: 'default' };
}

function heuristicScore({ variant, learned }) {
  const hook = variant.hook || {};
  const hookLine = hook.hookLine || '';
  const script = hook.script || '';
  const words = hookLine.trim().split(/\s+/).filter(Boolean).length;

  // 1) Hook gucu (aci agirligi: ogrenilmis > arastirma > varsayilan)
  const { weight, weightSource } = angleWeight(hook, learned);
  const hookStrength = weight * 100;
  // 2) Kisalik: 4-10 kelime ideal
  let brevity = 100;
  if (words === 0) brevity = 0;
  else if (words > 14) brevity = 55;
  else if (words > 10) brevity = 75;
  else if (words < 3) brevity = 70;
  // 3) CTA varligi
  const ctaRe = /(linke?|link|bak|incele|gör|dene|sıra sende|check|see|try|details|turn)/i;
  const cta = ctaRe.test(script) ? 100 : 60;
  // 4) Netlik: script uzunlugu makul mu (kelime 8-30)
  const sw = script.trim().split(/\s+/).filter(Boolean).length;
  let clarity = 100;
  if (sw < 6) clarity = 65;
  else if (sw > 45) clarity = 70;

  const value = clamp(Math.round(0.4 * hookStrength + 0.25 * brevity + 0.2 * cta + 0.15 * clarity));
  const breakdown = {
    hookStrength: Math.round(hookStrength),
    brevity: Math.round(brevity),
    cta: Math.round(cta),
    clarity: Math.round(clarity),
    weightSource,
  };
  const sourceNote = { learned: ' (kendi reklam sonuçlarından öğrenildi)', research: ' (rakip araştırmasında kanıtlanmış)', default: '' }[weightSource];
  const reason = `Açı: ${hook.angle || '—'} (dikkat gücü ${breakdown.hookStrength}${sourceNote}). Hook ${words} kelime. ${breakdown.cta === 100 ? 'CTA var.' : 'CTA zayıf.'}`;
  return { value, breakdown, reason, source };
}

// LLM prompt'unu kurar. Markanin kendi reklam sonuclari (learned) ve rakip arastirmasi
// (researchBacked) LLM'e de verilir; aksi halde anahtar varken ogrenme dongusu skoru etkilemezdi.
function buildLlmPrompt({ variant, campaign, learned }) {
  const hook = variant.hook || {};
  const style = getStyle(hook.styleId);
  const avatar = getAvatar(variant.avatarId);
  const lang = campaign?.brand?.language === 'en' ? 'English' : 'Turkish';
  const system = `You are a performance-marketing analyst who predicts how well a short UGC video ad will convert for DTC/e-commerce. You judge the spoken script/hook, the chosen visual style, and the presenter persona. Be calibrated and critical. When the brand's own past ad results are given, they outweigh general intuition. Output STRICT JSON only.`;

  const evidence = [];
  if (learned && Object.keys(learned).length) {
    const rows = Object.entries(learned)
      .sort((a, b) => b[1] - a[1])
      .map(([a, w]) => `${a}: ${w}`)
      .join(', ');
    evidence.push(`This brand's REAL ad results, relative angle strength (0.60 weakest .. 0.95 best): ${rows}. This variant's angle: ${hook.angle || '—'}.`);
  }
  if (hook.researchBacked) {
    evidence.push(`This angle is proven in long-running competitor ads${hook.reference ? ` (reference: "${hook.reference}")` : ''}.`);
  }

  const user = `Score this UGC ad variant's predicted conversion potential from 0 to 100.

Product: ${campaign?.brief?.product || '—'}
Benefit: ${campaign?.brief?.benefit || '—'}
Audience: ${campaign?.brief?.audience || 'general DTC shoppers'}
Spoken language: ${lang}
Visual style: ${style.label.en}
Presenter persona: ${avatar.persona}
Angle: ${hook.angle || '—'}
Hook line: "${hook.hookLine || ''}"
Full script: "${hook.script || ''}"
${evidence.length ? `\nEvidence:\n- ${evidence.join('\n- ')}\n` : ''}
Return JSON:
{ "value": <0-100 integer>,
  "predictedCtrTier": "low|medium|high",
  "breakdown": { "hookStrength": <0-100>, "clarity": <0-100>, "brevity": <0-100>, "audienceFit": <0-100> },
  "reason": "<one concise sentence, in Turkish>" }
No commentary outside JSON.`;
  return { system, user };
}

async function llmScore({ variant, campaign, learned }) {
  const hook = variant.hook || {};
  const { system, user } = buildLlmPrompt({ variant, campaign, learned });
  const data = await callLLM(system, user, { maxTokens: 400, json: true, temperature: 0.3 });
  return {
    value: clamp(Math.round(data.value ?? 0)),
    breakdown: data.breakdown || {},
    reason: data.reason || '',
    predictedCtrTier: data.predictedCtrTier || null,
    weightSource: angleWeight(hook, learned).weightSource,
    source,
  };
}

async function score({ variant, campaign, learned }) {
  if (llmAvailable()) {
    try {
      return await llmScore({ variant, campaign, learned });
    } catch (e) {
      console.warn('[scorer] LLM skor basarisiz, heuristige dusuluyor:', e.message);
    }
  }
  return heuristicScore({ variant, learned });
}

module.exports = { id, label, source, score, heuristicScore, angleWeight, buildLlmPrompt, ANGLE_WEIGHT };
