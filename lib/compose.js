// lib/compose.js — ORTAK ON-SAHNE (her iki motor da bunu kullanir).
//
// Marka tek bir urun fotografi verir. Bu modul, urunu farkli avatar personalariyla
// bir sahne goseline yerlestirir (nano-banana image-edit). Cikan gorsel sonra
// image-to-video (Veo) veya lipsync (zincir) icin baz olur.
//
// (avatar x style) basina BIR kez uretilir; pipeline bunu cache'ler ve ayni
// avatar+style'i paylasan hook'lar arasinda yeniden kullanir -> maliyet dususu.
//
// NOT: nano-banana endpoint/param adlari fal'de degisebilir. submitWithFallback ile
// birkac olasi sema denenir; ilk calisan kullanilir.

const path = require('path');
const fal = require('./fal');
const store = require('./store');
const { getStyle } = require('./styles');
const { getAvatar } = require('./avatars');

const ROOT = path.join(__dirname, '..');
const NANO_EDIT = 'fal-ai/nano-banana/edit'; // urun referansli (image-to-image)
const NANO_T2I = 'fal-ai/nano-banana';       // referanssiz (text-to-image)

// fal modelleri uzak URL ister: yerel upload'i ('/uploads/..') fal CDN'e BIR KEZ yukle,
// kampanyada cache'le. Yerel faceless motor bu fonksiyona hic ugramaz.
async function remoteProductUrl(campaignId) {
  const camp = store.readCampaign(campaignId);
  if (!camp?.productImageUrl) return null;
  if (/^https?:\/\//i.test(camp.productImageUrl)) return camp.productImageUrl;
  if (camp.productImageRemoteUrl) return camp.productImageRemoteUrl;
  const rel = camp.productImageUrl.replace(/^\//, '').replace(/\//g, path.sep);
  const fs = require('fs');
  const localPath = [path.join(ROOT, rel), path.join(ROOT, 'public', rel)].find((p) => fs.existsSync(p));
  if (!localPath) return null;
  const ext = path.extname(localPath).toLowerCase();
  const mime = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
  const url = await fal.upload(localPath, mime, path.basename(localPath));
  store.updateCampaign(campaignId, { productImageRemoteUrl: url });
  return url;
}

function buildScenePrompt({ avatar, style, productNote }) {
  return [
    `Photorealistic vertical 9:16 portrait.`,
    `Subject: ${avatar.persona}, in ${avatar.setting}.`,
    `The subject is holding and presenting the product from the reference image, with the product clearly visible and its label/logo intact and undistorted.`,
    style.scene,
    productNote || '',
    `Natural, candid, authentic look. Clean realistic image. No on-screen text, no captions, no watermark, no logo overlay.`,
  ]
    .filter(Boolean)
    .join(' ');
}

function extractImageUrl(body) {
  if (!body) return null;
  if (body.images && body.images[0]) return body.images[0].url || body.images[0];
  if (body.image && body.image.url) return body.image.url;
  if (typeof body.image === 'string') return body.image;
  if (body.url) return body.url;
  return null;
}

// Tek bir (avatar, style) icin sahne goseli uret. productImageUrl varsa edit yolu.
async function composeScene({ productImageUrl, avatarId, styleId, productNote, onState }) {
  const avatar = getAvatar(avatarId);
  const style = getStyle(styleId);
  const prompt = buildScenePrompt({ avatar, style, productNote });

  let endpoint, payloadVariants;
  if (productImageUrl) {
    endpoint = NANO_EDIT;
    // farkli param adlari icin kademeli fallback (zenginden yaline)
    payloadVariants = [
      { prompt, image_urls: [productImageUrl], num_images: 1, output_format: 'jpeg', aspect_ratio: '9:16' },
      { prompt, image_urls: [productImageUrl], num_images: 1 },
      { prompt, image_url: productImageUrl, num_images: 1 },
    ];
  } else {
    endpoint = NANO_T2I;
    payloadVariants = [
      { prompt, num_images: 1, output_format: 'jpeg', aspect_ratio: '9:16' },
      { prompt, num_images: 1 },
    ];
  }

  const sub = await fal.submitWithFallback(endpoint, payloadVariants);
  const job = { endpoint, requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url };
  const { body } = await fal.pollJob(job, { pollMs: 4000, maxPolls: 60, onState });
  const url = extractImageUrl(body);
  if (!url) throw new fal.FalError('Sahne goseli URL alinamadi (nano-banana).', { status: 0, kind: 'http', body });
  return url;
}

module.exports = { composeScene, buildScenePrompt, remoteProductUrl, NANO_EDIT, NANO_T2I };
