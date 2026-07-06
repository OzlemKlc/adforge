// lib/models.js — SABIT MODEL HAVUZU (tek kaynak).
//
// Skill'in "model serbest secilmez, sabit havuzdan secilir" ilkesinin kod karsiligi.
// Hem maliyet motoru hem uretim motorlari buradan okur. Yeni model = buraya bir satir.
//
// Fiyatlar/endpoint'ler 2026-05'te fal kataloglarinda dogrulandi. fal model
// adlarini revize edebilir; ilk gercek calistirmada get_model_schema / ilk cagri ile
// dogrulanmali (bkz. README "Dogrulama" notu).

// Kalite seviyesi -> Veo ailesi (<=8 sn). 'uzun' otomatik Seedance'e gider.
// 'yerel': fal'siz faceless motor — sifir maliyet, 15-30 sn (tts + ffmpeg, lokal render).
// 'avatar': hibrit ust-seviye motor — yerel TTS + Kling lipsync; sure = ses uzunlugu.
const LEVELS = {
  yerel: {
    label: { tr: 'Yerel (ücretsiz)', en: 'Local (free)' },
    family: 'local',
    engine: 'faceless',
    pricePerSec: 0,
    durations: ['15s', '20s', '25s', '30s'],
  },
  avatar: {
    label: { tr: 'Avatar (Kling, üst seviye)', en: 'Avatar (Kling, premium)' },
    family: 'avatar',
    engine: 'avatar',
    pricePerSec: 0.0562,
    durations: ['10s', '15s'],
  },
  ekonomik: {
    label: { tr: 'Ekonomik', en: 'Economy' },
    family: 'veo',
    i2v: 'fal-ai/veo3.1/lite/image-to-video',
    t2v: 'fal-ai/veo3.1/fast', // lite t2v acik degil -> fast'e dus
    pricePerSec: 0.05,
    durations: ['4s', '6s', '8s'],
  },
  standart: {
    label: { tr: 'Standart', en: 'Standard' },
    family: 'veo',
    i2v: 'fal-ai/veo3.1/fast/image-to-video',
    t2v: 'fal-ai/veo3.1/fast',
    pricePerSec: 0.15,
    durations: ['4s', '6s', '8s'],
  },
  premium: {
    label: { tr: 'Premium', en: 'Premium' },
    family: 'veo',
    i2v: 'fal-ai/veo3.1/image-to-video',
    t2v: 'fal-ai/veo3.1',
    pricePerSec: 0.40,
    durations: ['4s', '6s', '8s'],
  },
  uzun: {
    label: { tr: 'Uzun (9–15 sn)', en: 'Long (9–15s)' },
    family: 'seedance',
    i2v: 'bytedance/seedance-2.0/fast/image-to-video',
    t2v: 'bytedance/seedance-2.0/fast/text-to-video',
    pricePerSec: 0.10,
    durations: ['9', '10', '11', '12', '13', '14', '15'],
  },
};

const IMAGE_MODEL = { endpoint: 'fal-ai/nano-banana', pricePerImage: 0.04 };
const SUBTITLE = { endpoint: 'fal-ai/workflow-utilities/auto-subtitle', pricePerMin: 0.03 };
// Hibrit avatar motoru: ses bizden (edge-tts, $0), animasyon+lipsync Kling'den.
// Cikti suresi otomatik ses uzunlugu kadar -> maliyet = ses saniyesi x fiyat.
const AVATAR_MODEL = { endpoint: 'fal-ai/kling-video/ai-avatar/v2/standard', pricePerSec: 0.0562 };

// Zincir motoru icin (v2) — yer tutucu fiyatlar; v2'de dogrulanacak.
const CHAIN = {
  tts: { endpoint: 'fal-ai/elevenlabs/tts/multilingual-v2', pricePerCall: 0.02 },
  lipsync: { endpoint: 'fal-ai/sync-lipsync', pricePerCall: 0.10 },
};

function levelForDuration(level, durationSec) {
  // yerel/avatar motorlar kendi surelerini yonetir; Seedance'e DUSMEMELI
  if (['local', 'avatar'].includes(LEVELS[level]?.family)) return level;
  return durationSec > 8 ? 'uzun' : level;
}

function getLevel(level) {
  return LEVELS[level] || LEVELS.standart;
}

module.exports = { LEVELS, IMAGE_MODEL, SUBTITLE, CHAIN, AVATAR_MODEL, levelForDuration, getLevel };
