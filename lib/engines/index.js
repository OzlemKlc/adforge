// lib/engines/index.js — URETIM MOTORU REGISTRY'si (genisleme noktasi #3).
//
// Motor turleri iki eksende ayrisir:
//   Akis:   mode 'run'   -> pipeline engine.run()'i tek await eder; compose engine.compose();
//                           altyazi motorun icinde gomulur, SUBTITLE asamasi atlanir.
//           mode 'queue' -> klasik fal kuyrugu: submit() -> poll -> auto-subtitle.
//   Maliyet: needsFal true -> FAL_KEY ister (ucretli). false -> tamamen yerel/ucretsiz.
//
//   faceless: run  + ucretsiz  (edge-tts + ffmpeg B-roll)
//   avatar:   run  + fal       (yerel TTS + Kling lipsync — ust seviye, ~$0.60/video)
//   veo:      queue + fal      (Veo/Seedance konusan video — en yuksek kalite/maliyet)
//
// Yeni motor eklemek = ayni arayuzde dosya yazip ENGINES'a eklemek.

const veo = require('./veo');
const faceless = require('./faceless');
const avatar = require('./avatar');
// const chain = require('./chain'); // v2: gorsel->TTS->lipsync ekonomi motoru

const ENGINES = {
  [faceless.id]: faceless,
  [avatar.id]: avatar,
  [veo.id]: veo,
  // [chain.id]: chain,
};

// Varsayilan: yerel ucretsiz motor. ENGINE env ile degistirilebilir (orn. ENGINE=avatar).
const DEFAULT_ENGINE = ENGINES[process.env.ENGINE] ? process.env.ENGINE : faceless.id;

// mode:'run' veya eski local bayragi -> pipeline'in awaited yolu
const isRunEngine = (e) => !!e.local || e.mode === 'run';
// fal anahtari gereksinimi: acikca isaretli VEYA klasik kuyruk motoru
const engineNeedsFal = (e) => !!e.needsFal || (!e.local && e.mode !== 'run');

const getEngine = (id) => ENGINES[id] || ENGINES[DEFAULT_ENGINE];
const listEngines = () =>
  Object.values(ENGINES).map((e) => ({
    id: e.id,
    label: e.label,
    free: !engineNeedsFal(e),
    available: !engineNeedsFal(e) || !!process.env.FAL_KEY,
  }));

module.exports = { ENGINES, DEFAULT_ENGINE, getEngine, listEngines, isRunEngine, engineNeedsFal };
