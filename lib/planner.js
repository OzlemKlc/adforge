// lib/planner.js — HOOK URETICI.
//
// Bir brief'ten `count` adet birbirinden farkli kanca (hook) + kisa script uretir.
// Her hook'a bir tarz atanir (config.styles round-robin). Hook'lar varyantlarin
// A/B test eksenidir: count hook x avatars avatar = toplam varyant.
//
// Mod (lib/llm.js): auto/llm -> Claude ile zengin hook; template -> dahili sablon havuzu.
// LLM cagrisi basarisiz olursa otomatik sablona duser (uygulama hep calisir).

const { newId } = require('./store');
const { getStyle, defaultStyle } = require('./styles');
const { llmAvailable, callLLM } = require('./llm');

// --- Sablon kanca havuzu (LLM yoksa) ---
// Her aci icin TR ve EN kalip. {product}, {benefit}, {brand} doldurulur.
const ANGLES = {
  curiosity: {
    tr: { hook: 'Bunu kimse söylemiyor ama {product} gerçekten fark yaratıyor.', cta: 'Detaylar linkte.' },
    en: { hook: 'Nobody talks about this, but {product} actually makes a difference.', cta: 'Details in the link.' },
  },
  testimonial: {
    tr: { hook: '{product} bir süredir kullanıyorum ve cidden şaşırdım.', cta: 'Denemeye değer.' },
    en: { hook: "I've been using {product} for a while and honestly, I'm surprised.", cta: 'Worth a try.' },
  },
  pain: {
    tr: { hook: 'Aynı sorunu tekrar tekrar yaşamaktan bıktıysan, dur.', cta: 'Linke bak.' },
    en: { hook: "If you're tired of dealing with the same problem over and over, stop.", cta: 'Check the link.' },
  },
  bold_result: {
    tr: { hook: 'Birkaç gün içinde {benefit} — abartmıyorum.', cta: 'Kendin gör.' },
    en: { hook: "In just a few days: {benefit} — I'm not exaggerating.", cta: 'See for yourself.' },
  },
  social_proof: {
    tr: { hook: 'Herkes {product} konuşuyordu, sonunda ben de denedim.', cta: 'Sıra sende.' },
    en: { hook: 'Everyone was talking about {product}, so I finally tried it.', cta: 'Your turn.' },
  },
  mistake: {
    tr: { hook: 'Yıllarca yanlış ürünü aldım, keşke bunu daha önce bilseydim.', cta: 'Aynı hatayı yapma.' },
    en: { hook: 'I bought the wrong thing for years — I wish I knew this sooner.', cta: "Don't make my mistake." },
  },
  question: {
    tr: { hook: '{benefit} için ne kullanıyorsun? Ben artık sadece bunu.', cta: 'Linkten incele.' },
    en: { hook: 'What do you use for {benefit}? I only use this now.', cta: 'Check it out.' },
  },
  demo: {
    tr: { hook: 'Dur, {product} nasıl çalışıyor göstereyim.', cta: 'Hepsi linkte.' },
    en: { hook: 'Wait, let me show you how {product} works.', cta: "It's all in the link." },
  },
};
const ANGLE_KEYS = Object.keys(ANGLES);

function fill(str, ctx) {
  return str
    .replace(/\{product\}/g, ctx.product || (ctx.lang === 'tr' ? 'bu ürün' : 'this product'))
    .replace(/\{benefit\}/g, ctx.benefit || (ctx.lang === 'tr' ? 'gözle görülür bir fark' : 'a visible difference'))
    .replace(/\{brand\}/g, ctx.brand || '');
}

function buildBenefitLine(ctx) {
  if (!ctx.benefit) return '';
  return ctx.lang === 'tr' ? `Özellikle ${ctx.benefit} konusunda.` : `Especially when it comes to ${ctx.benefit}.`;
}

// Tarzlari hook'lara dagit: tek tarz -> hepsi; coklu -> round-robin.
function styleForIndex(styleIds, i) {
  if (!styleIds || !styleIds.length) return defaultStyle().id;
  return styleIds[i % styleIds.length];
}

function templateHooks({ product, benefit, brand, language, count, styleIds }) {
  const lang = language === 'en' ? 'en' : 'tr';
  const hooks = [];
  for (let i = 0; i < count; i++) {
    const angleKey = ANGLE_KEYS[i % ANGLE_KEYS.length];
    const a = ANGLES[angleKey][lang];
    const ctx = { product, benefit, brand, lang };
    const hookLine = fill(a.hook, ctx);
    const benefitLine = buildBenefitLine(ctx);
    const cta = fill(a.cta, ctx);
    const script = [hookLine, benefitLine, cta].filter(Boolean).join(' ');
    hooks.push({
      id: newId('hook_'),
      angle: angleKey,
      styleId: styleForIndex(styleIds, i),
      hookLine,
      script,
      language: lang,
    });
  }
  return hooks;
}

// --- LLM hook uretici ---
async function llmHooks({ product, benefit, brand, audience, tone, language, count, styleIds }) {
  const lang = language === 'en' ? 'English' : 'Turkish';
  const styleList = (styleIds || []).map((id) => getStyle(id).label.en).join(', ');
  const system = `You are a senior direct-response UGC ad copywriter. You write scroll-stopping short-form video scripts (TikTok/Reels) that drive conversions. You write natural spoken copy, not billboard slogans. Output STRICT JSON only.`;
  const user = `Write ${count} DISTINCT UGC ad hooks for an A/B test, each with a different psychological angle (curiosity, pain, bold result, social proof, mistake, question, demo, testimonial).

Product: ${product || '(unspecified)'}
Key benefit: ${benefit || '(unspecified)'}
Brand: ${brand || '(unspecified)'}
Target audience: ${audience || '(general DTC shoppers)'}
Brand tone: ${tone || 'authentic, friendly'}
Suggested visual styles to vary across hooks: ${styleList || 'varied'}
Language of the SPOKEN script: ${lang}

For each hook return an object with:
- "angle": short slug of the psychological angle
- "hookLine": the first spoken line (the 2-second hook), in ${lang}, max ~12 words, must stop the scroll
- "script": the full short spoken script in ${lang} (hook + one benefit line + a short CTA), 2-3 short sentences, natural conversational speech, fits ~8 seconds

Return JSON: { "hooks": [ {"angle","hookLine","script"}, ... ] } with exactly ${count} items. No commentary.`;

  const data = await callLLM(system, user, { maxTokens: 1200, json: true, temperature: 0.9 });
  const arr = Array.isArray(data) ? data : data.hooks || [];
  return arr.slice(0, count).map((h, i) => ({
    id: newId('hook_'),
    angle: h.angle || ANGLE_KEYS[i % ANGLE_KEYS.length],
    styleId: styleForIndex(styleIds, i),
    hookLine: (h.hookLine || '').trim(),
    script: (h.script || h.hookLine || '').trim(),
    language: language === 'en' ? 'en' : 'tr',
  }));
}

// Ana giris. Her zaman bir hook dizisi doner (LLM patlarsa sablona duser).
async function generateHooks(opts) {
  const count = Math.max(1, opts.count || 4);
  const params = { ...opts, count };
  if (llmAvailable()) {
    try {
      const hooks = await llmHooks(params);
      if (hooks.length) return { hooks, source: 'llm' };
    } catch (e) {
      // sessizce sablona dus
      console.warn('[planner] LLM hook uretimi basarisiz, sablona dusuluyor:', e.message);
    }
  }
  return { hooks: templateHooks(params), source: 'template' };
}

module.exports = { generateHooks, templateHooks, ANGLE_KEYS };
