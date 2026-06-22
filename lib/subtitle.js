// lib/subtitle.js — Ayri altyazi modeli (auto-subtitle). SEMA-GUVENLI.
//
// Eski paketteki Bug B: stil parametreleri (font_size, highlight_color, ...) semada
// yoksa 422 verir. Burada once zengin stil denenir; 422 olursa kademeli olarak
// yalin {video_url, language}'e dusulur. Boylece altyazi adimi her zaman calisir.

const fal = require('./fal');
const { SUBTITLE } = require('./models');

async function addSubtitles({ videoUrl, language, onState }) {
  const lang = language === 'en' ? 'en' : 'tr';
  const styled = {
    video_url: videoUrl,
    language: lang,
    font_size: 90,
    highlight_color: 'yellow',
    stroke_width: 3,
    position: 'bottom',
  };
  const minimal = { video_url: videoUrl, language: lang };

  const sub = await fal.submitWithFallback(SUBTITLE.endpoint, [styled, minimal]);
  const job = { endpoint: SUBTITLE.endpoint, requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url };
  const { body } = await fal.pollJob(job, { pollMs: 4000, maxPolls: 60, onState });

  const url = body?.video?.url || (typeof body?.video === 'string' ? body.video : null) || body?.url || null;
  return { subtitledUrl: url, transcription: body?.transcription || null };
}

module.exports = { addSubtitles };
