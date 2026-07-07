// lib/engines/avatar.js — HIBRIT UST-SEVIYE MOTOR (fotogerçekçi konusan avatar).
//
// "Higgsfield seviyesi" cikti, minimum fal maliyetiyle. Is bolumu:
//   PAHALI kisim (fal):   sahne goseli (nano-banana, $0.04) + lipsync animasyon
//                         (Kling AI Avatar v2 standard, $0.0562/sn — sure = ses uzunlugu)
//   BEDAVA kisim (yerel): seslendirme (edge-tts, TR/EN) + kelime-senkron karaoke
//                         altyazi burn (ffmpeg). fal auto-subtitle'a gerek yok.
//
// ~10 sn video ≈ $0.60 (sahne kardes varyantlarla paylasilinca daha da dusuk).
// Veo yolundan ~2x ucuz; ses tamamen bizim kontrolumuzde (persona/prosodi registry).
//
// Akis (mode:'run' — pipeline tek await eder, SUBTITLE asamasi atlanir):
//   compose()  urun fotografini fal CDN'e (lazy) + nano-banana avatar+urun sahnesi
//   run()      TTS -> ses fal CDN'e -> Kling submit/poll -> mp4 indir -> karaoke burn
//
// Cifte-ucret korumasi: Kling requestId variant'a persist edilir; restart sonrasi
// resume ayni isi POLL eder, yeniden submit ETMEZ (veo yolundaki garanti burada da).

const fs = require('fs');
const path = require('path');

const fal = require('../fal');
const store = require('../store');
const tts = require('../tts');
const captions = require('../captions');
const video = require('../video');
const { composeScene, remoteProductUrl } = require('../compose');
const { AVATAR_MODEL } = require('../models');

const ROOT = path.join(__dirname, '..', '..');
const RENDERS_DIR = path.join(ROOT, 'data', 'renders');
const FONTS_DIR = path.join(ROOT, 'assets', 'fonts');
const KEEP_TEMP = process.env.KEEP_TEMP === '1';

const id = 'avatar';
const label = { tr: 'Avatar (Kling — üst seviye)', en: 'Avatar (Kling — premium)' };
const mode = 'run';
const needsFal = true;

const toPublicUrl = (absPath) =>
  '/renders/' + path.relative(RENDERS_DIR, absPath).replace(/\\/g, '/');

// Sahne: nano-banana ile fotogerçekçi "avatar urunu sunuyor" goseli (fal CDN URL doner).
// (avatar x style) basina bir kez; pipeline kardes varyantlarda yeniden kullanir.
async function compose({ campaignId, camp, variant }) {
  const productImageUrl = await remoteProductUrl(campaignId);
  const heroUrl = await composeScene({
    productImageUrl,
    avatarId: variant.avatarId,
    styleId: variant.hook.styleId,
    productNote: camp.brief?.product ? `The product is ${camp.brief.product}.` : '',
  });
  return { heroUrl, sceneAssets: [heroUrl] };
}

// Animasyon yonlendirme metni (Kling'e opsiyonel prompt)
function motionPrompt(language) {
  const lang = language === 'en' ? 'English' : 'Turkish';
  return `Natural authentic UGC-style talking head. The person speaks directly to camera in ${lang} with accurate lip-sync, subtle natural head and hand movements, keeping the product clearly visible. No on-screen text.`;
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video indirilemedi (${res.status})`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

async function renameWithRetry(from, to, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (!['EPERM', 'EBUSY'].includes(e.code) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function run({ campaignId, variantId, camp, variant, language }) {
  const styleId = variant.hook.styleId;
  const outDir = path.join(RENDERS_DIR, campaignId);
  const workDir = path.join(outDir, `${variantId}-work`);
  const resuming = !!(variant.requestId && variant.endpoint === AVATAR_MODEL.endpoint);
  if (!resuming) fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const timingsPath = path.join(workDir, 'tts-timings.json');
  let success = false;

  try {
    // 1) TTS (yerel, $0). Resume'da onceki zamanlamalar varsa yeniden sentezleme —
    //    Kling'e giden sesle birebir ayni kalsin (caption kaymasi olmasin).
    let t;
    if (resuming && fs.existsSync(timingsPath)) {
      t = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
    } else {
      t = await tts.synthesize({
        text: variant.hook.script,
        language,
        avatarId: variant.avatarId,
        outPath: path.join(workDir, 'voice.mp3'),
      });
      fs.writeFileSync(timingsPath, JSON.stringify(t));
    }

    // 2-3) Ses fal CDN'e + Kling submit (resume'da atla: requestId persist edilmis)
    let job;
    if (resuming) {
      job = { endpoint: variant.endpoint, requestId: variant.requestId, statusUrl: variant.statusUrl, responseUrl: variant.responseUrl };
    } else {
      // ses formati backend'e gore degisir (edge=mp3, piper=wav) — dogru mime/uzanti ile yukle
      const audioUrl = await fal.upload(t.audioPath, t.audioMime || 'audio/mpeg', `${variantId}${t.audioExt || '.mp3'}`);
      const sub = await fal.submitWithFallback(AVATAR_MODEL.endpoint, [
        { image_url: variant.sceneImageUrl, audio_url: audioUrl, prompt: motionPrompt(language) },
        { image_url: variant.sceneImageUrl, audio_url: audioUrl },
      ]);
      job = { endpoint: AVATAR_MODEL.endpoint, requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url };
      // cifte ucret korumasi: requestId'yi hemen persist et
      store.updateVariant(campaignId, variantId, { endpoint: job.endpoint, requestId: job.requestId, statusUrl: job.statusUrl, responseUrl: job.responseUrl });
    }

    // 4) poll (lipsync uretimi ses uzunluguna gore 1-5 dk surebilir)
    const { body } = await fal.pollJob(job, { pollMs: 6000, maxPolls: 200 });
    const remoteUrl = (body?.video && body.video.url) || body?.url;
    if (!remoteUrl) throw new Error('Kling video URL alınamadı.');

    // 5) indir + karaoke altyazi burn (yerel, $0)
    const rawPath = path.join(workDir, 'raw.mp4');
    await downloadTo(remoteUrl, rawPath);
    const videoDur = await video.probeDuration(rawPath);

    const assPath = path.join(workDir, 'subs.ass');
    captions.writeAss(
      captions.buildAss({
        words: t.words,
        sentences: t.sentences,
        hookLine: variant.hook.hookLine,
        styleId,
        videoDur,
        language,
      }),
      assPath
    );

    const tmpFinal = path.join(workDir, 'final.mp4');
    await video.burnSubtitles({ videoPath: rawPath, assPath, outPath: tmpFinal, fontsDir: FONTS_DIR });

    const finalPath = path.join(outDir, `${variantId}.mp4`);
    fs.rmSync(finalPath, { force: true });
    await renameWithRetry(tmpFinal, finalPath);

    success = true;
    return { videoUrl: toPublicUrl(finalPath), durationSec: videoDur, ttsBackend: t.backend, rawVideoUrl: remoteUrl };
  } finally {
    // Basarida temizle; hatada BIRAK — resume timings + requestId'yi buradan okur
    // (Kling isi yeniden submit edilmez, cifte ucret olmaz).
    if (!KEEP_TEMP && success) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { id, label, mode, needsFal, compose, run };
