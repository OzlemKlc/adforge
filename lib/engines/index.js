// lib/engines/index.js — URETIM MOTORU REGISTRY'si (genisleme noktasi #3).
//
// Bir motor su arayüzü saglar:
//   id: string
//   label: { tr, en }
//   async submit({ sceneImageUrl, script, language, level, durationSec }) -> job
//        job = { engine, endpoint, requestId, statusUrl, responseUrl }
//   extractVideoUrl(body) -> string | null
//
// Yeni motor eklemek (orn. v2 zincir: gorsel->TTS->lipsync):
//   1) lib/engines/chain.js yaz (ayni arayüz)
//   2) asagidaki ENGINES'a ekle
// Pipeline tarafi degismez.

const veo = require('./veo');
// const chain = require('./chain'); // v2: gorsel->TTS->lipsync ekonomi motoru

const ENGINES = {
  [veo.id]: veo,
  // [chain.id]: chain,
};

const DEFAULT_ENGINE = veo.id;

const getEngine = (id) => ENGINES[id] || ENGINES[DEFAULT_ENGINE];
const listEngines = () => Object.values(ENGINES).map((e) => ({ id: e.id, label: e.label }));

module.exports = { ENGINES, DEFAULT_ENGINE, getEngine, listEngines };
