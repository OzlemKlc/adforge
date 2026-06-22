// lib/engines/veo.js — VEO uretim motoru (v1 omurga).
//
// Kompoze edilmis sahne goselini (avatar+urun) alir, image-to-video + native ses ile
// avatarin hook'u konustugu temiz (altyazisiz) videoyu uretir. En yuksek kalite,
// TR ve EN ses icin guvenli. duration > 8 sn ise otomatik Seedance'e gider.
//
// Motor arayüzü:  submit(opts) -> job;  extractVideoUrl(body) -> url

const fal = require('../fal');
const { getLevel, levelForDuration } = require('../models');

const id = 'veo';
const label = { tr: 'Veo (yüksek kalite)', en: 'Veo (high quality)' };

function buildPrompt({ script, language, simple = false }) {
  const lang = language === 'en' ? 'English' : 'Turkish';
  const accent = language === 'en' ? 'native English accent' : 'native Turkish accent';
  if (simple) {
    return `A person speaks directly to camera in ${lang} (${accent}): "${script}". Natural ambient sound. Clean realistic image, no on-screen text.`;
  }
  return [
    `The person in the image talks directly to the camera in an authentic, natural UGC style,`,
    `with subtle handheld micro-movements and accurate lip-sync to the spoken words.`,
    `They speak in ${lang} (${accent}): "${script}".`,
    `Keep the product clearly visible and undistorted.`,
    `Natural ambient sound, no background music. Clean realistic image, no on-screen text, no captions, no subtitles.`,
  ].join(' ');
}

// Animasyon isini kuyruga gonder. job persist edilmeli (resume icin).
async function submit({ sceneImageUrl, script, language, level, durationSec }) {
  const lvl = levelForDuration(level, durationSec);
  const m = getLevel(lvl);
  const endpoint = m.i2v;
  const isSeedance = m.family === 'seedance';
  const rich = buildPrompt({ script, language, simple: false });
  const simple = buildPrompt({ script, language, simple: true });

  let payloadVariants;
  if (isSeedance) {
    // Seedance: kisa prompt, negative_prompt YOK
    payloadVariants = [
      { image_url: sceneImageUrl, prompt: simple, aspect_ratio: '9:16', resolution: '1080p', duration: String(durationSec), generate_audio: true },
    ];
  } else {
    const base = {
      image_url: sceneImageUrl,
      aspect_ratio: '9:16',
      // Veo kisitlamasi: 1080p yalnizca 8s ile gecerli (ozellikle Lite). Kisa sureler -> 720p.
      resolution: durationSec >= 8 ? '1080p' : '720p',
      duration: `${durationSec}s`,
      generate_audio: true,
      negative_prompt: 'on-screen text, captions, subtitles, watermark, logo overlay, blur, distortion, low quality',
    };
    payloadVariants = [
      { ...base, prompt: rich, safety_tolerance: '4', auto_fix: true },
      { ...base, prompt: simple, safety_tolerance: '5', auto_fix: true }, // 422 fallback: sadelestir
    ];
  }

  const sub = await fal.submitWithFallback(endpoint, payloadVariants);
  return { engine: id, endpoint, requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url };
}

function extractVideoUrl(body) {
  if (!body) return null;
  if (body.video && body.video.url) return body.video.url;
  if (typeof body.video === 'string') return body.video;
  if (body.url) return body.url;
  return null;
}

module.exports = { id, label, submit, extractVideoUrl };
