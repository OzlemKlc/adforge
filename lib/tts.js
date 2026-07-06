// lib/tts.js — YEREL/UCRETSIZ SESLENDIRME KATMANI (genisleme noktasi #5).
//
// Backend soyutlamasi: ayni arayuzle birden fazla TTS kaynagi.
//   edge  : Microsoft Edge Read-Aloud (ucretsiz, dogal neural sesler, internet ister)
//           + WordBoundary olaylari -> kelime bazli zaman damgasi (whisper'a gerek yok)
//   piper : Tamamen offline yedek (rhasspy/piper, manuel kurulum; PIPER_PATH/PIPER_MODEL env)
//           Kelime zamani = ses suresine orantisal dagitim (ayni donus semasi)
//
// Arayuz:
//   synthesize({ text, language, avatarId, outPath })
//     -> { audioPath, durationSec, words:[{word,start,end}], sentences:[{start,end}], backend }
//   voiceFor(avatarId, language) -> { voice, rate, pitch }
//   ttsInfo() -> { backend, voices }

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TTS_BACKEND = (process.env.TTS_BACKEND || 'auto').toLowerCase(); // auto | edge | piper

// --- Ses registry'si: 8 avatar personasi -> ses + prosodi (TR ve EN) ---
// Edge'de 2 TR neural ses var (Emel/Ahmet); personalar rate/pitch ile ayrisir.
const VOICE_DEFAULTS = {
  tr: {
    female: process.env.TTS_VOICE_TR_FEMALE || 'tr-TR-EmelNeural',
    male: process.env.TTS_VOICE_TR_MALE || 'tr-TR-AhmetNeural',
  },
  en: {
    female: process.env.TTS_VOICE_EN_FEMALE || 'en-US-JennyNeural',
    male: process.env.TTS_VOICE_EN_MALE || 'en-US-GuyNeural',
  },
};

// avatarId -> { gender, rate, pitch, enVoice? } (enVoice: EN'de persona cesitliligi icin override)
const PERSONA_PROSODY = {
  'genc-kadin-dogal': { gender: 'female', rate: '+2%', pitch: '+0Hz' },
  'genc-erkek-enerjik': { gender: 'male', rate: '+12%', pitch: '+10Hz' },
  'olgun-kadin-guvenilir': { gender: 'female', rate: '-6%', pitch: '-15Hz', enVoice: 'en-US-AriaNeural' },
  'genc-kadin-trend': { gender: 'female', rate: '+14%', pitch: '+25Hz' },
  'olgun-erkek-uzman': { gender: 'male', rate: '-8%', pitch: '-20Hz', enVoice: 'en-US-ChristopherNeural' },
  'genc-erkek-samimi': { gender: 'male', rate: '+0%', pitch: '-5Hz' },
  'genc-kadin-fit': { gender: 'female', rate: '+10%', pitch: '+10Hz' },
  'olgun-kadin-sicak': { gender: 'female', rate: '-4%', pitch: '-10Hz', enVoice: 'en-US-AriaNeural' },
};

function voiceFor(avatarId, language) {
  const lang = language === 'en' ? 'en' : 'tr';
  const p = PERSONA_PROSODY[avatarId] || { gender: 'female', rate: '+0%', pitch: '+0Hz' };
  const voice = (lang === 'en' && p.enVoice) ? p.enVoice : VOICE_DEFAULTS[lang][p.gender];
  return { voice, rate: p.rate, pitch: p.pitch };
}

// Edge Read-Aloud SSML metni: & < > " ' kacisi (urun adi "C&A" gibi seyler bozmasin)
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// --- edge backend'ine es zamanlilik siniri (ucretsiz endpoint'i bogmayalim) ---
let edgeActive = 0;
const edgeQueue = [];
function edgeLimit(fn) {
  return new Promise((resolve, reject) => {
    edgeQueue.push({ fn, resolve, reject });
    pumpEdge();
  });
}
function pumpEdge() {
  if (edgeActive >= 2 || !edgeQueue.length) return;
  edgeActive++;
  const { fn, resolve, reject } = edgeQueue.shift();
  Promise.resolve().then(fn).then(resolve, reject).finally(() => { edgeActive--; pumpEdge(); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- EDGE backend ---
async function edgeSynthesize({ text, voice, rate, pitch, outPath }) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });

  const { audioStream, metadataStream } = tts.toStream(escapeXml(text), { rate, pitch });

  const words = [];
  const sentences = [];

  const audioDone = new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    audioStream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    audioStream.on('error', reject);
  });

  const metaDone = new Promise((resolve) => {
    if (!metadataStream) return resolve();
    metadataStream.on('data', (chunk) => {
      try {
        const parsed = JSON.parse(chunk.toString('utf8'));
        for (const m of parsed.Metadata || []) {
          const d = m.Data || {};
          const start = (d.Offset || 0) / 1e7;
          const end = start + (d.Duration || 0) / 1e7;
          if (m.Type === 'WordBoundary') {
            const w = (d.text && d.text.Text) || '';
            if (w) words.push({ word: w, start, end });
          } else if (m.Type === 'SentenceBoundary') {
            sentences.push({ start, end });
          }
        }
      } catch { /* bozuk metadata chunk'i yut */ }
    });
    metadataStream.on('end', resolve);
    metadataStream.on('close', resolve);
    metadataStream.on('error', resolve); // metadata olmadan da devam edilebilir
  });

  // Once sesin diske inmesini bekle; metadata ses ile ic ice gelir ama stream'i
  // her zaman 'end' emit etmeyebilir -> kisa grace ile race et (yoksa event loop
  // bosalir ve Node sessizce cikar).
  await audioDone;
  await Promise.race([metaDone, sleep(700)]);
  try { tts.close(); } catch { /* ws zaten kapali olabilir */ }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
    throw new Error('edge-tts bos/eksik ses dondurdu');
  }
  return { words, sentences };
}

// --- PIPER backend (offline yedek) ---
async function piperSynthesize({ text, outPath }) {
  const bin = process.env.PIPER_PATH;
  const model = process.env.PIPER_MODEL;
  if (!bin || !model) throw new Error('Piper yapilandirilmamis (PIPER_PATH/PIPER_MODEL env gerekli)');
  const wavPath = outPath.replace(/\.mp3$/i, '.wav');
  await new Promise((resolve, reject) => {
    const p = spawn(bin, ['-m', model, '-f', wavPath], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`piper cikis ${code}: ${err.slice(-300)}`))));
    p.stdin.write(text, 'utf8');
    p.stdin.end();
  });
  return { audioPath: wavPath, words: [], sentences: [] };
}

// Kelime zamanlarini ses suresine orantisal dagit (piper / bos WordBoundary yedegi).
// Agirlik = kelime uzunlugu + 1 (kisa kelimeler daha hizli soylenir varsayimi).
function distributeWords(text, durationSec) {
  const tokens = String(text).split(/\s+/).filter(Boolean);
  const totalW = tokens.reduce((a, t) => a + t.length + 1, 0) || 1;
  const words = [];
  let t = 0;
  for (const tok of tokens) {
    const w = ((tok.length + 1) / totalW) * durationSec;
    words.push({ word: tok, start: t, end: t + w });
    t += w;
  }
  // cumle sinirlari: . ! ? ile biten kelimelerde kes
  const sentences = [];
  let sStart = 0;
  for (const w of words) {
    if (/[.!?…]$/.test(w.word)) { sentences.push({ start: sStart, end: w.end }); sStart = w.end; }
  }
  if (sStart < durationSec - 0.05) sentences.push({ start: sStart, end: durationSec });
  return { words, sentences };
}

// --- ana giris ---
// Donus semasi backend'den bagimsizdir; caption/video katmani farki bilmez.
async function synthesize({ text, language, avatarId, outPath }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const { voice, rate, pitch } = voiceFor(avatarId, language);

  const tryEdge = TTS_BACKEND === 'edge' || TTS_BACKEND === 'auto';
  const tryPiper = TTS_BACKEND === 'piper' || (TTS_BACKEND === 'auto' && process.env.PIPER_PATH);

  let lastErr = null;
  if (tryEdge) {
    const delays = [0, 2000, 5000];
    for (const d of delays) {
      if (d) await sleep(d);
      try {
        const { words, sentences } = await edgeLimit(() => edgeSynthesize({ text, voice, rate, pitch, outPath }));
        const durationSec = await require('./video').probeDuration(outPath);
        if (words.length) {
          return { audioPath: outPath, durationSec, words, sentences: sentences.length ? sentences : distributeWords(text, durationSec).sentences, backend: 'edge' };
        }
        // WordBoundary bos geldi -> orantisal dagitima dus (ses yine edge'den)
        const dist = distributeWords(text, durationSec);
        return { audioPath: outPath, durationSec, ...dist, backend: 'edge' };
      } catch (e) {
        lastErr = e;
        console.warn(`[tts] edge denemesi basarisiz (${e.message}), ${d ? 'tekrar' : 'retry'} ...`);
      }
    }
  }

  if (tryPiper) {
    const { audioPath } = await piperSynthesize({ text, outPath });
    const durationSec = await require('./video').probeDuration(audioPath);
    const dist = distributeWords(text, durationSec);
    return { audioPath, durationSec, ...dist, backend: 'piper' };
  }

  throw new Error(`TTS başarısız: ${lastErr ? lastErr.message : 'kullanılabilir backend yok'}`);
}

function ttsInfo() {
  return {
    backend: TTS_BACKEND,
    piper: !!process.env.PIPER_PATH,
    voices: { tr: VOICE_DEFAULTS.tr, en: VOICE_DEFAULTS.en },
  };
}

module.exports = { synthesize, voiceFor, ttsInfo, distributeWords };
