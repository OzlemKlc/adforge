// lib/cost.js — Maliyet motoru. Tum fiyatlar lib/models.js'ten gelir.
//
// Kampanya maliyeti uc kalemden olusur:
//   1) Kompozisyon: distinct(avatar x style) adet sahne goseli (nano-banana)
//   2) Animasyon: toplam varyant (avatar x hook) adet video (Veo/Seedance)
//   3) Altyazi: her varyant icin auto-subtitle

const { getLevel, levelForDuration, IMAGE_MODEL, SUBTITLE } = require('./models');

function parseDur(d) {
  return parseInt(String(d).replace('s', ''), 10) || 8;
}

function perVariantVideo(level, durationSec) {
  const lvl = levelForDuration(level, durationSec);
  const m = getLevel(lvl);
  return +(m.pricePerSec * durationSec).toFixed(3);
}

function perVariantSubtitle(durationSec) {
  return +(SUBTITLE.pricePerMin * (durationSec / 60)).toFixed(3);
}

// avatars: sayi, hooks: sayi, styleCount: kampanyada kullanilacak distinct tarz sayisi.
function estimateCampaign({ avatars = 2, hooks = 5, styleCount = 1, level = 'standart', duration = '8s' }) {
  const durationSec = parseDur(duration);
  const variants = avatars * hooks;
  const composeCount = avatars * Math.max(1, Math.min(styleCount, hooks));

  const compose = +(composeCount * IMAGE_MODEL.pricePerImage).toFixed(2);
  const video = +(variants * perVariantVideo(level, durationSec)).toFixed(2);
  const subtitle = +(variants * perVariantSubtitle(durationSec)).toFixed(2);
  const total = +(compose + video + subtitle).toFixed(2);

  return {
    variants,
    composeCount,
    perVariant: +(perVariantVideo(level, durationSec) + perVariantSubtitle(durationSec)).toFixed(2),
    breakdown: { compose, video, subtitle },
    total,
    level: levelForDuration(level, durationSec),
    durationSec,
  };
}

module.exports = { estimateCampaign, perVariantVideo, perVariantSubtitle, parseDur };
