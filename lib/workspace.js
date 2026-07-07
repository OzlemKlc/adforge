// lib/workspace.js — RENDER ARA DOSYALARI ICIN GUVENLI CALISMA ALANI.
//
// Neden: proje OneDrive altinda calisabiliyor. ffmpeg segment render'i sirasinda
// OneDrive senkron kilidi ara dosyalari (seg-*.mp4, silent.mp4, subs.ass) kilitleyip
// "Conversion failed!" (aralikli) hatasi uretiyor. Cozum: TUM ara dosyalari OneDrive
// DISINA (sistem temp) yaz; yalniz nihai mp4'u renders/'a yayinla.
//
// Kullanim:
//   const workDir = workspace.make(campaignId, variantId);   // temp altinda, sifirlanmis
//   ... ffmpeg ara dosyalari workDir'e ...
//   await workspace.publish(tmpFinal, finalPath);            // temp -> renders (guvenli)
//   workspace.cleanup(workDir);                              // basarida temizle

const fs = require('fs');
const os = require('os');
const path = require('path');

const WORK_ROOT = process.env.WORK_DIR || path.join(os.tmpdir(), 'adforge-work');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bir varyant icin taze calisma dizini (temp altinda). Idempotent: her cagride sifirlanir.
function make(campaignId, variantId) {
  const dir = path.join(WORK_ROOT, campaignId, variantId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Ara ciktiyi (temp) nihai konuma (renders, OneDrive) tasi. Cross-device (temp != C:)
// icin copy+unlink'e duser; OneDrive kilidi (EPERM/EBUSY) icin retry eder.
async function publish(from, to, tries = 4) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  for (let i = 0; i < tries; i++) {
    try {
      try {
        fs.renameSync(from, to); // ayni disk: hizli + atomik
      } catch (e) {
        if (e.code === 'EXDEV') {
          fs.copyFileSync(from, to); // farkli disk: kopyala
          fs.rmSync(from, { force: true });
        } else {
          throw e;
        }
      }
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY'].includes(e.code) || i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* onemsiz */ }
}

module.exports = { WORK_ROOT, make, publish, cleanup };
