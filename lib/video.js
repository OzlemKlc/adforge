// lib/video.js — FFMPEG YARDIMCILARI (yerel render katmani).
//
// Binary: ffmpeg-static (npm ile gelir, sistem kurulumu gerekmez).
// Tum cagrilar args-array + spawn (shell yok) — bosluk/Turkce karakterli yollar guvenli.
//
// Yerel faceless motorunun uc islemi:
//   renderSegment  urun goseli -> zoompan (Ken Burns) hareketli dikey klip
//   concatSegments klipleri birlestir (yeniden encode yok)
//   finalMux       ses + .ass altyazi burn + faststart -> nihai mp4

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || require('ffmpeg-static');
const FPS = parseInt(process.env.RENDER_FPS || '25', 10);
const CRF = process.env.RENDER_CRF || '21';

const W = 1080, H = 1920;       // cikti (9:16)
const SW = 2160, SH = 3840;     // sahne asset'leri 2x (zoompan'de netlik icin)

function run(args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let errTail = '';
    p.stderr.on('data', (d) => {
      errTail = (errTail + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('ffmpeg zaman asimi'));
    }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(errTail);
      else reject(new Error(`ffmpeg cikis ${code}: ...${errTail.slice(-800)}`));
    });
  });
}

// Sure olcumu (ffprobe'suz): dosyayi null'a decode et, stderr'deki son time= degerini oku.
async function probeDuration(file) {
  const err = await run(['-i', file, '-f', 'null', '-'], { timeoutMs: 120000 });
  const matches = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (!matches.length) throw new Error('sure okunamadi: ' + file);
  const m = matches[matches.length - 1];
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// Windows yolu -> filtergraph icinde guvenli hali ('C\:/Users/...')
function escapeForFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// --- HAREKET REGISTRY'si: UGC tarzi -> zoompan preset dizisi (segment basina cycle) ---
// Her preset (T: toplam kare) -> { z, x, y, pre? } zoompan ifadeleri.
// p = on/T (0..1 ilerleme). Merkez: x=iw/2-(iw/zoom/2), y=ih/2-(ih/zoom/2).
const CENTER_X = 'iw/2-(iw/zoom/2)';
const CENTER_Y = 'ih/2-(ih/zoom/2)';

function pushIn(from, to) {
  return (T) => ({ z: `${from}+${(to - from).toFixed(4)}*on/${T}`, x: CENTER_X, y: CENTER_Y });
}
function pullOut(from, to) {
  return pushIn(from, to); // ayni formul, from>to verilir
}
function panLR(zoom) {
  return (T) => ({ z: String(zoom), x: `(iw-iw/zoom)*on/${T}`, y: CENTER_Y });
}
function punchSteps(steps, amount) {
  // kesik kesik zoom "punch" hissi: floor ile basamakli buyume
  return (T) => ({ z: `1+${amount}*floor(on/(${T}/${steps}))`, x: CENTER_X, y: CENTER_Y });
}

const MOTIONS = {
  'samimi-itiraf': [pushIn(1.0, 1.08), pushIn(1.05, 1.12), pullOut(1.12, 1.04)],
  'heyecanli-kesif': [punchSteps(3, 0.05), pushIn(1.0, 1.14), punchSteps(2, 0.07)],
  'problem-cozum': [pullOut(1.14, 1.0), pushIn(1.0, 1.12), pushIn(1.04, 1.1)],
  'sokak-roportaji': [panLR(1.15), pushIn(1.0, 1.1), panLR(1.12)],
  'luks-estetik': [pushIn(1.0, 1.05), pushIn(1.03, 1.08), pullOut(1.08, 1.02)],
  'komik-eglenceli': [punchSteps(4, 0.05), punchSteps(2, 0.09), pushIn(1.0, 1.16)],
  'uzman-tavsiyesi': [pushIn(1.0, 1.06), pushIn(1.02, 1.08), pushIn(1.0, 1.05)],
  'once-sonra': [pushIn(1.0, 1.1), pushIn(1.0, 1.12), pullOut(1.1, 1.0)],
};

function motionFor(styleId, segIndex) {
  const list = MOTIONS[styleId] || MOTIONS['samimi-itiraf'];
  return list[segIndex % list.length];
}

// Tek segment render: sabit gorsel -> zoompan hareketli klip.
// pre: zoompan oncesi ek filtre (orn. once-sonra desaturasyonu: 'eq=saturation=0.35,')
async function renderSegment({ imagePath, durationSec, styleId, segIndex, outPath, pre = '' }) {
  const T = Math.max(2, Math.round(durationSec * FPS));
  const m = motionFor(styleId, segIndex)(T);
  const vf = [
    `scale=${SW}:${SH}:force_original_aspect_ratio=increase`,
    `crop=${SW}:${SH}`,
    pre.replace(/,$/, ''),
    `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${T}:fps=${FPS}:s=${W}x${H}`,
    'format=yuv420p',
  ].filter(Boolean).join(',');

  await run([
    '-i', imagePath,
    '-vf', vf,
    '-frames:v', String(T),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF,
    '-an', outPath,
  ]);
  return outPath;
}

// Segmentleri yeniden encode etmeden birlestir (concat demuxer).
async function concatSegments(segmentPaths, outPath) {
  const listPath = outPath + '.txt';
  const lines = segmentPaths
    .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, lines, 'utf8');
  await run(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
  fs.unlinkSync(listPath);
  return outPath;
}

// Nihai birlestirme: video + ses + .ass altyazi (burn) + faststart.
// -t + apad: ses erken bitse de video kuyrugu (CTA) kesilmez.
async function finalMux({ videoPath, audioPath, assPath, durationSec, outPath, fontsDir }) {
  const sub = `subtitles=filename='${escapeForFilter(assPath)}'` +
    (fontsDir ? `:fontsdir='${escapeForFilter(fontsDir)}'` : '');
  await run([
    '-i', videoPath,
    '-i', audioPath,
    '-vf', sub,
    '-map', '0:v', '-map', '1:a',
    '-af', 'apad',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', durationSec.toFixed(2),
    '-movflags', '+faststart',
    outPath,
  ]);
  return outPath;
}

// Hazir bir videoya .ass altyaziyi burn et (ses aynen kopyalanir).
// Hibrit avatar motoru icin: Kling'den gelen mp4 + bizim karaoke caption'lar.
async function burnSubtitles({ videoPath, assPath, outPath, fontsDir }) {
  const sub = `subtitles=filename='${escapeForFilter(assPath)}'` +
    (fontsDir ? `:fontsdir='${escapeForFilter(fontsDir)}'` : '');
  await run([
    '-i', videoPath,
    '-vf', sub,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF, '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outPath,
  ]);
  return outPath;
}

module.exports = { run, probeDuration, renderSegment, concatSegments, finalMux, burnSubtitles, escapeForFilter, MOTIONS, FPS, W, H, SW, SH };
