// lib/scorers/predicted.js — AI TAHMINI SKORLAYICI (v1).
//
// Her varyantin hook/script + tarz/avatar uyumunu 0-100 arasi tahmini bir
// "donusum potansiyeli" skoruna cevirir. LLM varsa Claude ile, yoksa heuristik.
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

function heuristicScore({ variant }) {
  const hook = variant.hook || {};
  const hookLine = hook.hookLine || '';
  const script = hook.script || '';
  const words = hookLine.trim().split(/\s+/).filter(Boolean).length;

  // 1) Hook gucu (aci agirligi)
  const hookStrength = (ANGLE_WEIGHT[hook.angle] ?? 0.75) * 100;
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
  };
  const reason = `Açı: ${hook.angle || '—'} (dikkat gücü ${breakdown.hookStrength}). Hook ${words} kelime. ${breakdown.cta === 100 ? 'CTA var.' : 'CTA zayıf.'}`;
  return { value, breakdown, reason, source };
}

async function llmScore({ variant, campaign }) {
  const hook = variant.hook || {};
  const style = getStyle(hook.styleId);
  const avatar = getAvatar(variant.avatarId);
  const lang = campaign?.brand?.language === 'en' ? 'English' : 'Turkish';
  const system = `You are a performance-marketing analyst who predicts how well a short UGC video ad will convert for DTC/e-commerce. You judge the spoken script/hook, the chosen visual style, and the presenter persona. Be calibrated and critical. Output STRICT JSON only.`;
  const user = `Score this UGC ad variant's predicted conversion potential from 0 to 100.

Product: ${campaign?.brief?.product || '—'}
Benefit: ${campaign?.brief?.benefit || '—'}
Audience: ${campaign?.brief?.audience || 'general DTC shoppers'}
Spoken language: ${lang}
Visual style: ${style.label.en}
Presenter persona: ${avatar.persona}
Hook line: "${hook.hookLine || ''}"
Full script: "${hook.script || ''}"

Return JSON:
{ "value": <0-100 integer>,
  "predictedCtrTier": "low|medium|high",
  "breakdown": { "hookStrength": <0-100>, "clarity": <0-100>, "brevity": <0-100>, "audienceFit": <0-100> },
  "reason": "<one concise sentence, in Turkish>" }
No commentary outside JSON.`;

  const data = await callLLM(system, user, { maxTokens: 400, json: true, temperature: 0.3 });
  return {
    value: clamp(Math.round(data.value ?? 0)),
    breakdown: data.breakdown || {},
    reason: data.reason || '',
    predictedCtrTier: data.predictedCtrTier || null,
    source,
  };
}

async function score({ variant, campaign }) {
  if (llmAvailable()) {
    try {
      return await llmScore({ variant, campaign });
    } catch (e) {
      console.warn('[scorer] LLM skor basarisiz, heuristige dusuluyor:', e.message);
    }
  }
  return heuristicScore({ variant });
}

module.exports = { id, label, source, score, heuristicScore };
