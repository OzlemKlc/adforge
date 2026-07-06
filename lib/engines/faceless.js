// lib/engines/faceless.js — YEREL "FACELESS UGC" MOTORU (fal.ai'siz, ucretsiz).
//
// Veo'nun aksine konusan avatar uretmez; urun odakli B-roll uretir:
//   sahne asset'leri (compose-local) -> zoompan segmentleri -> TTS seslendirme
//   -> karaoke altyazi + hook overlay (burn) -> tek mp4
//
// Motor arayuzu farki: fal motorlari submit/poll (async kuyruk), bu motor tek
// awaited islem. Bu yuzden `local: true` bayragi tasir ve pipeline COMPOSE/ANIMATE/
// SUBTITLE asamalarinda bu bayraga gore dallanir. Altyazi ANIMATE icinde gomulur,
// SUBTITLE asamasi atlanir.
//
// Cikti: data/renders/<campaignId>/<variantId>.mp4  (Express /renders altinda servis eder)

const fs = require('fs');
const path = require('path');

const tts = require('../tts');
const captions = require('../captions');
const video = require('../video');
const composeLocal = require('../compose-local');

const ROOT = path.join(__dirname, '..', '..');
const RENDERS_DIR = path.join(ROOT, 'data', 'renders');
const FONTS_DIR = path.join(ROOT, 'assets', 'fonts');
const KEEP_TEMP = process.env.KEEP_TEMP === '1';

const id = 'faceless';
const label = { tr: 'Yüz Göstermeden (yerel, ücretsiz)', en: 'Faceless (local, free)' };
const local = true;

const toPublicUrl = (absPath) =>
  '/renders/' + path.relative(RENDERS_DIR, absPath).replace(/\\/g, '/');
const toRootRel = (absPath) => path.relative(ROOT, absPath).replace(/\\/g, '/');
const fromRootRel = (rel) => (path.isAbsolute(rel) ? rel : path.join(ROOT, rel));

// Sahne uretimi — (avatar x style) basina bir kez cagrilir, kardes varyantlar paylasir.
async function compose({ campaignId, camp, variant }) {
  const styleId = variant.hook.styleId;
  const outDir = path.join(RENDERS_DIR, campaignId, 'scenes', `${variant.avatarId}-${styleId}`);
  const { heroPath, assets } = await composeLocal.composeSceneLocal({
    productImageUrl: camp.productImageUrl,
    styleId,
    avatarId: variant.avatarId,
    outDir,
    productName: camp.brief?.product,
    benefit: camp.brief?.benefit,
  });
  return { heroUrl: toPublicUrl(heroPath), sceneAssets: assets.map(toRootRel) };
}

// Video suresini segmentlere bol: 2-4 kesit, kesme noktalari cumle sinirina yaslanir.
function planSegments(videoDur, sentences) {
  const n = Math.max(2, Math.min(4, Math.round(videoDur / 6)));
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const ideal = (videoDur * i) / n;
    // ±1.5 sn icinde cumle siniri varsa oraya yasla
    let best = ideal;
    for (const st of sentences || []) {
      if (Math.abs(st.end - ideal) < Math.abs(best - ideal) && Math.abs(st.end - ideal) <= 1.5) best = st.end;
    }
    cuts.push(best);
  }
  const bounds = [0, ...cuts, videoDur];
  const segs = [];
  for (let i = 1; i < bounds.length; i++) {
    const d = bounds[i] - bounds[i - 1];
    if (d >= 1.2) segs.push(d);
    else if (segs.length) segs[segs.length - 1] += d; // cok kisa kesiti oncekine yedir
  }
  return segs.length ? segs : [videoDur];
}

// OneDrive/Windows dosya kilidi icin toleransli rename
async function renameWithRetry(from, to, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY'].includes(e.code) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

// Tek varyanti uctan uca render et. Idempotent: work dir her seferinde sifirlanir.
async function run({ campaignId, variantId, camp, variant, language, durationSec }) {
  const styleId = variant.hook.styleId;
  const outDir = path.join(RENDERS_DIR, campaignId);
  const workDir = path.join(outDir, `${variantId}-work`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // 0) sahne asset'leri (COMPOSE'dan gelir; yoksa guvenlik icin yeniden uret)
    let assets = (variant.sceneAssets || []).map(fromRootRel).filter((p) => fs.existsSync(p));
    if (!assets.length) {
      const c = await compose({ campaignId, camp, variant });
      assets = c.sceneAssets.map(fromRootRel);
    }

    // 1) TTS: script -> ses + kelime zamanlari
    const t = await tts.synthesize({
      text: variant.hook.script,
      language,
      avatarId: variant.avatarId,
      outPath: path.join(workDir, 'voice.mp3'),
    });

    // 2) hedef sure: kullanici secimi taban, ses daha uzunsa uzat (konusma kesilmez)
    const target = Math.max(durationSec || 15, t.durationSec + 1.2);
    const videoDur = Math.min(40, Math.max(12, target));

    // 3) segment plani + render (sirali — dusuk RAM'de tek ffmpeg süreci)
    const segs = planSegments(videoDur, t.sentences);
    const segPaths = [];
    for (let i = 0; i < segs.length; i++) {
      // once-sonra tarzi: ilk yari desatüre ("once"), ikinci yari canli ("sonra")
      const pre = styleId === 'once-sonra' && i < segs.length / 2 ? 'eq=saturation=0.35' : '';
      const segPath = path.join(workDir, `seg-${i}.mp4`);
      await video.renderSegment({
        imagePath: assets[i % assets.length],
        durationSec: segs[i],
        styleId,
        segIndex: i,
        outPath: segPath,
        pre,
      });
      segPaths.push(segPath);
    }

    // 4) birlestir
    const silentPath = path.join(workDir, 'silent.mp4');
    await video.concatSegments(segPaths, silentPath);

    // 5) altyazi (.ass): karaoke caption + hook overlay
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

    // 6) nihai mux: burn + ses + faststart
    const tmpFinal = path.join(workDir, 'final.mp4');
    await video.finalMux({
      videoPath: silentPath,
      audioPath: t.audioPath,
      assPath,
      durationSec: videoDur,
      outPath: tmpFinal,
      fontsDir: FONTS_DIR,
    });

    const finalPath = path.join(outDir, `${variantId}.mp4`);
    fs.rmSync(finalPath, { force: true });
    await renameWithRetry(tmpFinal, finalPath);

    return { videoUrl: toPublicUrl(finalPath), durationSec: videoDur, ttsBackend: t.backend };
  } finally {
    if (!KEEP_TEMP) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { id, label, local, compose, run };
