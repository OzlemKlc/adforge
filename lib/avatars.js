// lib/avatars.js — AVATAR PERSONA REGISTRY'si (genisleme noktasi #2).
//
// v1: sistem hazir kutuphane. Marka sadece urun fotografi verir; AdForge buradan
// cesitli personalari secer ve urunu onlara sunturur.
// SONRAKI SURUM: marka kendi influencer/model fotografini yukler -> source: 'uploaded'
// avatar nesnesi olarak ayni semaya eklenir (image alani dolu gelir).
//
// Yeni persona eklemek = AVATARS'a bir nesne eklemek.
// persona/setting metinleri Ingilizce (modeller icin); label TR/EN (UI icin).
// Avatar konustugu dili kampanyadan alir (TR veya EN) — persona dil-notr.

const AVATARS = {
  'genc-kadin-dogal': {
    id: 'genc-kadin-dogal',
    label: { tr: 'Genç kadın — doğal', en: 'Young woman — natural' },
    persona: 'a relatable woman in her late 20s, fresh-faced with minimal makeup, warm and friendly, approachable everyday look',
    setting: 'a clean, softly lit home setting (bathroom or living room) with natural daylight',
    voiceTone: { tr: 'sıcak, samimi, sohbet eder gibi', en: 'warm, sincere, conversational' },
    energy: 'calm',
    source: 'library',
  },
  'genc-erkek-enerjik': {
    id: 'genc-erkek-enerjik',
    label: { tr: 'Genç erkek — enerjik', en: 'Young man — energetic' },
    persona: 'a casual man in his late 20s to early 30s, short tidy hair, friendly confident smile, modern streetwear',
    setting: 'a bright modern apartment or outdoor urban setting',
    voiceTone: { tr: 'enerjik, pozitif, tempolu', en: 'energetic, upbeat, fast-paced' },
    energy: 'high',
    source: 'library',
  },
  'olgun-kadin-guvenilir': {
    id: 'olgun-kadin-guvenilir',
    label: { tr: 'Olgun kadın — güvenilir', en: 'Mature woman — trustworthy' },
    persona: 'a poised woman in her late 30s to 40s, well-groomed, calm and credible, the kind of person friends ask for advice',
    setting: 'a tidy, professional-but-cozy home or studio with soft lighting',
    voiceTone: { tr: 'sakin, güven veren, bilgili', en: 'calm, reassuring, knowledgeable' },
    energy: 'calm',
    source: 'library',
  },
  'genc-kadin-trend': {
    id: 'genc-kadin-trend',
    label: { tr: 'Genç kadın — trend', en: 'Young woman — trendy' },
    persona: 'a stylish woman in her early-to-mid 20s, on-trend makeup and outfit, expressive and a bit playful, Gen-Z social-media vibe',
    setting: 'an aesthetic bedroom or cafe with colorful, vibrant lighting',
    voiceTone: { tr: 'eğlenceli, hızlı, dikkat çekici', en: 'playful, fast, attention-grabbing' },
    energy: 'high',
    source: 'library',
  },
  'olgun-erkek-uzman': {
    id: 'olgun-erkek-uzman',
    label: { tr: 'Olgun erkek — uzman', en: 'Mature man — expert' },
    persona: 'a credible man in his 40s, neat appearance, calm authoritative presence, looks like an experienced professional',
    setting: 'a clean professional-but-approachable office or studio with soft directional lighting',
    voiceTone: { tr: 'net, otoriter ama samimi', en: 'clear, authoritative yet approachable' },
    energy: 'calm',
    source: 'library',
  },
  'genc-erkek-samimi': {
    id: 'genc-erkek-samimi',
    label: { tr: 'Genç erkek — samimi', en: 'Young man — candid' },
    persona: 'an everyday relatable man in his late 20s, casual hoodie, genuine unpolished demeanor, talks like a real friend',
    setting: 'a casual home setting (kitchen or living room) with natural light',
    voiceTone: { tr: 'içten, doğal, abartısız', en: 'sincere, natural, understated' },
    energy: 'calm',
    source: 'library',
  },
  'genc-kadin-fit': {
    id: 'genc-kadin-fit',
    label: { tr: 'Genç kadın — fit/sağlıklı', en: 'Young woman — fit/wellness' },
    persona: 'an athletic woman in her late 20s to early 30s, healthy glow, activewear, motivated and positive energy',
    setting: 'a bright home gym, kitchen, or sunny outdoor space',
    voiceTone: { tr: 'motive edici, canlı, içten', en: 'motivating, lively, sincere' },
    energy: 'high',
    source: 'library',
  },
  'olgun-kadin-sicak': {
    id: 'olgun-kadin-sicak',
    label: { tr: 'Olgun kadın — sıcak/anne', en: 'Mature woman — warm/parent' },
    persona: 'a warm woman in her late 30s to 40s, gentle nurturing presence, relatable parent vibe, comfortable casual style',
    setting: 'a cozy lived-in home (kitchen or living room) with soft warm light',
    voiceTone: { tr: 'şefkatli, samimi, güven veren', en: 'warm, caring, reassuring' },
    energy: 'calm',
    source: 'library',
  },
};

const listAvatars = () => Object.values(AVATARS);
const getAvatar = (id) => AVATARS[id] || listAvatars()[0];
const avatarIds = () => Object.keys(AVATARS);

// Bir kampanya icin n adet cesitli avatar sec. Belirli id'ler verilmediyse
// enerji/cinsiyet cesitliligini gozeterek ilk n'i dondurur.
function pickAvatars(n, preferredIds) {
  if (preferredIds && preferredIds.length) {
    return preferredIds.slice(0, n).map(getAvatar);
  }
  return listAvatars().slice(0, n);
}

module.exports = { AVATARS, listAvatars, getAvatar, avatarIds, pickAvatars };
