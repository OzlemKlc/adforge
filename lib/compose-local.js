// lib/compose-local.js — YEREL SAHNE URETICI (nano-banana'nin ucretsiz karsiligi).
//
// fal'a gorsel urettirmek yerine urun fotografindan sharp ile 5 sahne varyanti cikarir:
//   hero      blur-cover arka plan + urun ortada (ana kadraj)
//   close     urun kadraji dolduran yakin cekim (attention crop)
//   detail-a  ust bolge punch-zoom kesiti
//   detail-b  alt bolge punch-zoom kesiti
//   card      tarza gore gradyan arka plan + urun (CTA sahnesi)
//
// Asset'ler 2160x3840 (cikti 1080x1920'nin 2 kati) — zoompan'de netlik kaybi olmaz.
// avatarId deterministik varyasyon tohumudur (crop offset + ton) -> kardes varyantlar
// ayni urunle bile gorsel olarak farklilasir.
//
// Urun fotografi yoksa: tipografik sahneler (gradyan + urun adi/fayda) — video her
// kosulda uretilir.
//
// Opsiyonel BG_REMOVAL=1: @imgly/background-removal-node kuruluysa urun arka plani
// kaldirilip card/hero'ya cutout olarak basilir (yavas + RAM ister, varsayilan kapali).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { SW, SH } = require('./video'); // asset boyutu = video.js supersampling (tek kaynak)

const ROOT = path.join(__dirname, '..');
const JPEG_Q = 82;

// Tarz -> gradyan arka plan (card sahnesi + tipografik yedek icin)
const STYLE_BACKDROPS = {
  'samimi-itiraf': { from: '#F7EDE2', to: '#E8D5C4', text: '#3B2F2F' },
  'heyecanli-kesif': { from: '#FF9D3C', to: '#FF4326', text: '#FFFFFF' },
  'problem-cozum': { from: '#1E293B', to: '#0F172A', text: '#FFFFFF' },
  'sokak-roportaji': { from: '#3B82F6', to: '#1E3A8A', text: '#FFFFFF' },
  'luks-estetik': { from: '#191512', to: '#060504', text: '#E8C15A' },
  'komik-eglenceli': { from: '#FDE047', to: '#F97316', text: '#1F1300' },
  'uzman-tavsiyesi': { from: '#F1F5F9', to: '#CBD5E1', text: '#0F172A' },
  'once-sonra': { from: '#334155', to: '#0F172A', text: '#FFFFFF' },
};

function backdropFor(styleId) {
  return STYLE_BACKDROPS[styleId] || STYLE_BACKDROPS['samimi-itiraf'];
}

// Basit deterministik hash -> 0..1 (avatar bazli varyasyon tohumu)
function seed01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function gradientSvg({ from, to }, w = SW, h = SH) {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
    </svg>`
  );
}

function escSvg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Metni ~n karakterlik satirlara bol (tipografik sahne icin)
function wrapText(text, maxChars = 14) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}

function typographicSvg({ productName, benefit, styleId }) {
  const bd = backdropFor(styleId);
  const nameLines = wrapText(productName || 'Ürün', 12);
  const benefitLines = wrapText(benefit || '', 24);
  const nameSize = 200, benefitSize = 88;
  const startY = SH * 0.34;
  const nameTs = nameLines.map((l, i) =>
    `<text x="${SW / 2}" y="${startY + i * nameSize * 1.15}" font-size="${nameSize}" font-weight="900" font-family="Segoe UI Black, Arial Black, Arial" fill="${bd.text}" text-anchor="middle">${escSvg(l)}</text>`).join('');
  const bStart = startY + nameLines.length * nameSize * 1.15 + 140;
  const benefitTs = benefitLines.map((l, i) =>
    `<text x="${SW / 2}" y="${bStart + i * benefitSize * 1.4}" font-size="${benefitSize}" font-weight="600" font-family="Segoe UI, Arial" fill="${bd.text}" fill-opacity="0.85" text-anchor="middle">${escSvg(l)}</text>`).join('');
  return Buffer.from(
    `<svg width="${SW}" height="${SH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="${bd.from}"/><stop offset="1" stop-color="${bd.to}"/>
      </linearGradient></defs>
      <rect width="${SW}" height="${SH}" fill="url(#g)"/>
      ${nameTs}${benefitTs}
    </svg>`
  );
}

// Opsiyonel arka plan kaldirma (BG_REMOVAL=1 + paket kuruluysa)
let bgRemovalBusy = Promise.resolve();
async function tryRemoveBackground(srcPath, outPath) {
  if (process.env.BG_REMOVAL !== '1') return null;
  let removeBackground;
  try {
    ({ removeBackground } = require('@imgly/background-removal-node'));
  } catch {
    return null; // paket kurulu degil -> sessizce normal yola dus
  }
  // RAM icin seri calistir
  const job = bgRemovalBusy.then(async () => {
    const blob = await removeBackground(srcPath);
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return outPath;
  });
  bgRemovalBusy = job.catch(() => {});
  try { return await job; } catch (e) {
    console.warn('[compose-local] bg-removal basarisiz, normal yol:', e.message);
    return null;
  }
}

// URL -> yerel dosya yolu. '/uploads/..' kokte, '/assets/..' public altinda; http(s) indirilir.
async function resolveProductImage(url, workDir) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    const dest = path.join(workDir, '_source-download');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ürün görseli indirilemedi (${res.status})`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }
  const rel = url.replace(/^\//, '').replace(/\//g, path.sep);
  const candidates = [path.join(ROOT, rel), path.join(ROOT, 'public', rel)];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function composeSceneLocal({ productImageUrl, styleId, avatarId, outDir, productName, benefit }) {
  fs.mkdirSync(outDir, { recursive: true });
  const s = seed01(`${avatarId}:${styleId}`);
  const hueShift = Math.round((s - 0.5) * 24); // ±12 derece
  const bd = backdropFor(styleId);

  const src = await resolveProductImage(productImageUrl, outDir);
  const out = (name) => path.join(outDir, name);
  const assets = [];

  if (!src) {
    // --- tipografik sahneler (urun fotografi yok) ---
    const svg = typographicSvg({ productName, benefit, styleId });
    await sharp(svg).jpeg({ quality: JPEG_Q }).toFile(out('hero.jpg'));
    // hafif varyasyonlar: ayni svg farkli ton
    await sharp(svg).modulate({ hue: 12 }).jpeg({ quality: JPEG_Q }).toFile(out('card.jpg'));
    await sharp(svg).modulate({ brightness: 0.9 }).jpeg({ quality: JPEG_Q }).toFile(out('close.jpg'));
    assets.push(out('hero.jpg'), out('close.jpg'), out('card.jpg'));
    return { heroPath: out('hero.jpg'), assets };
  }

  // urun cutout (opsiyonel)
  const cutout = await tryRemoveBackground(src, out('_cutout.png'));
  const productSrc = cutout || src;

  // --- hero: blur-cover arka plan + urun ortada ---
  const backdrop = await sharp(src)
    .resize(SW, SH, { fit: 'cover' })
    .blur(45)
    .modulate({ brightness: 0.55, saturation: 1.15, hue: hueShift })
    .toBuffer();
  const heroProduct = await sharp(productSrc)
    .resize(Math.round(SW * 0.79), Math.round(SH * 0.57), { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  const hp = await sharp(heroProduct).metadata();
  await sharp(backdrop)
    .composite([{ input: heroProduct, left: Math.round((SW - hp.width) / 2), top: Math.round((SH - hp.height) / 2) }])
    .jpeg({ quality: JPEG_Q })
    .toFile(out('hero.jpg'));
  assets.push(out('hero.jpg'));

  // --- close: kadraji dolduran yakin cekim ---
  await sharp(src)
    .resize(SW, SH, { fit: 'cover', position: sharp.strategy.attention })
    .modulate({ saturation: 1.08, hue: hueShift })
    .jpeg({ quality: JPEG_Q })
    .toFile(out('close.jpg'));
  assets.push(out('close.jpg'));

  // --- detail-a / detail-b: buyutulmus kesitler (punch-zoom malzemesi) ---
  const zoomW = Math.round(SW * 1.6), zoomH = Math.round(SH * 1.6);
  const zoomed = await sharp(src)
    .resize(zoomW, zoomH, { fit: 'cover' })
    .toBuffer();
  const maxLeft = zoomW - SW, maxTop = zoomH - SH;
  const leftA = Math.round(maxLeft * (0.15 + 0.4 * s));
  await sharp(zoomed)
    .extract({ left: leftA, top: Math.round(maxTop * 0.12), width: SW, height: SH })
    .jpeg({ quality: JPEG_Q })
    .toFile(out('detail-a.jpg'));
  assets.push(out('detail-a.jpg'));
  const leftB = Math.round(maxLeft * (0.45 + 0.4 * (1 - s)));
  await sharp(zoomed)
    .extract({ left: leftB, top: Math.round(maxTop * 0.72), width: SW, height: SH })
    .jpeg({ quality: JPEG_Q })
    .toFile(out('detail-b.jpg'));
  assets.push(out('detail-b.jpg'));

  // --- card: tarza gore gradyan + urun (CTA sahnesi) ---
  const cardProduct = await sharp(productSrc)
    .resize(Math.round(SW * 0.83), Math.round(SH * 0.49), { fit: 'inside' })
    .toBuffer();
  const cp = await sharp(cardProduct).metadata();
  await sharp(gradientSvg(bd))
    .composite([{ input: cardProduct, left: Math.round((SW - cp.width) / 2), top: Math.round(SH * 0.52 - cp.height / 2) }])
    .jpeg({ quality: JPEG_Q })
    .toFile(out('card.jpg'));
  assets.push(out('card.jpg'));

  if (cutout) { try { fs.unlinkSync(cutout); } catch { /* temizlik */ } }

  return { heroPath: out('hero.jpg'), assets };
}

module.exports = { composeSceneLocal, resolveProductImage, STYLE_BACKDROPS };
