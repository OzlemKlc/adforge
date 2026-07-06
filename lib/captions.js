// lib/captions.js — ASS ALTYAZI URETICI (karaoke caption + hook overlay).
//
// Girdi: tts.js'in kelime zaman damgalari (WordBoundary) + hook satiri + UGC tarzi.
// Cikti: tek .ass dosyasi (iki stil: Hook ustte, Caption altta karaoke highlight).
// ffmpeg subtitles filtresiyle burn edilir — TikTok/CapCut tarzi kelime kelime yanan altyazi.
//
// Turkce guvenligi: UTF-8 + BOM, ASS ozel karakter temizligi, gomulu OFL fontlar
// (assets/fonts) fontsdir ile verilir — 'ığüşöçİ' tam kapsanir.

const fs = require('fs');

// UGC tarzi -> caption temasi. Renkler RGB hex (ASS'e BGR cevrilir).
// primary = highlight (kelime "yanarken"), secondary = henuz soylenmemis kelime rengi.
const CAPTION_THEMES = {
  'samimi-itiraf': { font: 'Archivo Black', size: 62, primary: 'FFD500', secondary: 'FFFFFF', outline: '000000', hookFont: 'Archivo Black', hookSize: 76, hookColor: 'FFFFFF' },
  'heyecanli-kesif': { font: 'Archivo Black', size: 64, primary: 'FF7A00', secondary: 'FFFFFF', outline: '000000', hookFont: 'Archivo Black', hookSize: 80, hookColor: 'FFE45C' },
  'problem-cozum': { font: 'Archivo Black', size: 62, primary: '4ADE80', secondary: 'FFFFFF', outline: '000000', hookFont: 'Archivo Black', hookSize: 76, hookColor: 'FFFFFF' },
  'sokak-roportaji': { font: 'Anton', size: 66, primary: '7CB6FF', secondary: 'FFFFFF', outline: '000000', hookFont: 'Anton', hookSize: 82, hookColor: 'FFFFFF' },
  'luks-estetik': { font: 'Anton', size: 56, primary: 'E8C15A', secondary: 'F5F0E6', outline: '1A140A', hookFont: 'Anton', hookSize: 68, hookColor: 'E8C15A', spacing: 2 },
  'komik-eglenceli': { font: 'Archivo Black', size: 66, primary: 'FF4326', secondary: 'FFFFFF', outline: '000000', hookFont: 'Archivo Black', hookSize: 86, hookColor: 'FFE45C', pop: true },
  'uzman-tavsiyesi': { font: 'Anton', size: 60, primary: '9BD1FF', secondary: 'FFFFFF', outline: '000000', hookFont: 'Anton', hookSize: 74, hookColor: 'FFFFFF' },
  'once-sonra': { font: 'Archivo Black', size: 62, primary: '4ADE80', secondary: 'FFFFFF', outline: '000000', hookFont: 'Archivo Black', hookSize: 76, hookColor: 'FFFFFF' },
};

function theme(styleId) {
  return CAPTION_THEMES[styleId] || CAPTION_THEMES['samimi-itiraf'];
}

// RGB hex -> ASS renk (&HAABBGGRR — BGR sirali!)
function assColor(rgbHex, alpha = '00') {
  const r = rgbHex.slice(0, 2), g = rgbHex.slice(2, 4), b = rgbHex.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`;
}

// saniye -> ASS zaman formati (h:mm:ss.cc)
function t(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cc = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(Math.min(99, cc)).padStart(2, '0')}`;
}

// ASS metin temizligi: suslu parantez tag acar, ters bolu kacis baslatir.
function assEscape(s) {
  return String(s).replace(/\{/g, '(').replace(/\}/g, ')').replace(/\\/g, '/').replace(/\r?\n/g, ' ');
}

// Kelimeleri 2-4 kelimelik caption satirlarina boluruz (~18 karakter hedef).
function chunkWords(words) {
  const chunks = [];
  let cur = [];
  let curLen = 0;
  for (const w of words) {
    cur.push(w);
    curLen += w.word.length + 1;
    const boundary = /[.!?…]$/.test(w.word);
    if (cur.length >= 4 || curLen >= 18 || boundary) {
      chunks.push(cur); cur = []; curLen = 0;
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// Tek chunk -> karaoke Dialogue metni. \kf suresi santisaniye cinsindendir.
// Kelime araligindaki sessizlik bir sonraki kelimeye yedirilir -> highlight kesintisiz akar.
function karaokeText(chunk, chunkEnd) {
  let out = '';
  for (let i = 0; i < chunk.length; i++) {
    const w = chunk[i];
    const wEnd = i < chunk.length - 1 ? chunk[i + 1].start : chunkEnd;
    const cs = Math.max(1, Math.round((wEnd - w.start) * 100));
    out += `{\\kf${cs}}${assEscape(w.word)}${i < chunk.length - 1 ? ' ' : ''}`;
  }
  return out;
}

function buildAss({ words, sentences, hookLine, styleId, videoDur, language = 'tr' }) {
  const th = theme(styleId);
  const playX = 1080, playY = 1920;

  const styles = [
    // Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut,
    // ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    `Style: Caption,${th.font},${th.size},${assColor(th.primary)},${assColor(th.secondary)},${assColor(th.outline)},${assColor('000000', '80')},0,0,0,0,100,100,${th.spacing || 0},0,1,4,1,2,60,60,420,1`,
    `Style: Hook,${th.hookFont},${th.hookSize},${assColor(th.hookColor)},${assColor(th.hookColor)},${assColor('000000')},${assColor('000000', '80')},0,0,0,0,100,100,${th.spacing || 0},0,1,5,2,8,70,70,260,1`,
  ];

  const events = [];

  // --- Hook overlay (ustte, ilk saniyeler) ---
  if (hookLine) {
    const firstSentEnd = (sentences && sentences[0] && sentences[0].end) || 2.5;
    const hookEnd = Math.min(3.5, Math.max(1.5, firstSentEnd));
    const upper = language === 'tr' ? hookLine.toLocaleUpperCase('tr-TR') : hookLine.toLocaleUpperCase('en-US');
    const pop = th.pop ? '{\\t(0,120,\\fscx112\\fscy112)}{\\t(120,260,\\fscx100\\fscy100)}' : '';
    events.push(`Dialogue: 1,${t(0)},${t(hookEnd)},Hook,,0,0,0,,{\\fad(120,150)}${pop}${assEscape(upper)}`);
  }

  // --- Karaoke caption'lar (altta) ---
  const chunks = chunkWords(words || []);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const start = chunk[0].start;
    // chunk sonu: bir sonraki chunk'in basina kadar uzat (bosluk kalmasin), son chunk kelime sonunda biter
    const end = i < chunks.length - 1
      ? Math.max(chunk[chunk.length - 1].end, chunks[i + 1][0].start)
      : Math.min(chunk[chunk.length - 1].end + 0.35, videoDur);
    events.push(`Dialogue: 0,${t(start)},${t(end)},Caption,,0,0,0,,${karaokeText(chunk, end)}`);
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playX}`,
    `PlayResY: ${playY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\r\n');
}

// UTF-8 + BOM yaz (libass Turkce karakterleri dogru okusun)
function writeAss(content, outPath) {
  fs.writeFileSync(outPath, '﻿' + content, 'utf8');
  return outPath;
}

module.exports = { buildAss, writeAss, CAPTION_THEMES };
