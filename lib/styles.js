// lib/styles.js — UGC TARZ REGISTRY'si (genisleme noktasi #1).
//
// Yeni tarz eklemek = STYLES'a bir nesne eklemek. Baska yeri degistirmeye gerek yok.
// Sahne metinleri (scene) Ingilizce yazilir (modeller Ingilizce yonergeyi daha iyi
// yorumlar); karakterin konustugu dil kampanyaya gore TR veya EN olur.
//
// ONEMLI: Sahne metinlerinde "burned-in subtitles / on-screen text" YOKtur — altyazi
// ayri bir modelle (auto-subtitle) eklenir. (Eski paketteki Bug A burada duzeltildi.)

const STYLES = {
  'samimi-itiraf': {
    id: 'samimi-itiraf',
    label: { tr: 'Samimi İtiraf', en: 'Candid Testimonial' },
    desc: { tr: 'Gerçek kullanıcı kameraya içtenlikle anlatır. En çok dönüşen klasik UGC.', en: 'A real user speaks sincerely to camera. The highest-converting classic UGC.' },
    hookStyle: 'testimonial',
    scene:
      'Vertical handheld selfie-style video. The presenter talks directly to camera with a warm, sincere, casual tone — as if telling a close friend a secret. Natural daylight, slight handheld shake, medium close-up. First 2 seconds: an honest, attention-grabbing opener. Authentic, unpolished, trustworthy mood. Subtle ambient room tone, no background music.',
    isDefault: true,
  },
  'heyecanli-kesif': {
    id: 'heyecanli-kesif',
    label: { tr: 'Heyecanlı Keşif', en: 'Excited Unboxing' },
    desc: { tr: 'Ürün kutudan çıkarılır, ilk izlenim heyecanı.', en: 'The product is revealed; first-impression excitement.' },
    hookStyle: 'unboxing',
    scene:
      'Vertical handheld video, energetic and bright. The presenter excitedly reveals the product, quick close-ups of hands and the product, genuine surprise and delight on their face. Dynamic but smooth camera, vibrant lighting. First 2 seconds: the product reveal with an excited reaction. Upbeat, fun energy.',
  },
  'problem-cozum': {
    id: 'problem-cozum',
    label: { tr: 'Problem–Çözüm', en: 'Problem–Solution' },
    desc: { tr: 'Bir sorun gösterilir, ürün çözüm olarak sunulur.', en: 'A pain point is shown; the product solves it.' },
    hookStyle: 'problem',
    scene:
      'Vertical video. Opens on a relatable everyday frustration shown in the first 2 seconds with a slightly annoyed expression. Then the presenter picks up the product and the mood shifts to relief and satisfaction. Handheld, natural light, expressive face. Emotional arc from frustration to relief.',
  },
  'sokak-roportaji': {
    id: 'sokak-roportaji',
    label: { tr: 'Sokak Röportajı', en: 'Street Interview' },
    desc: { tr: 'Sokakta doğal mini röportaj havası.', en: 'A natural candid street-interview vibe.' },
    hookStyle: 'interview',
    scene:
      'Vertical street-interview style video on a busy sidewalk. Casual, candid mood. The presenter answers naturally and positively about the product, with authentic, slightly surprised reactions. Handheld documentary feel, natural outdoor light, blurred city background. Real, unscripted feel.',
  },
  'luks-estetik': {
    id: 'luks-estetik',
    label: { tr: 'Lüks / Estetik', en: 'Luxury / Aesthetic' },
    desc: { tr: 'Yavaş, sinematik, premium his. Pahalı ürünler için.', en: 'Slow, cinematic, premium feel. For high-end products.' },
    hookStyle: 'aspirational',
    scene:
      'Vertical cinematic video, premium aesthetic. Slow, elegant camera movement. Macro detail shots of the product, soft directional lighting, refined color grading, shallow depth of field. The presenter speaks with a calm, confident voice. Minimal, sophisticated, aspirational atmosphere with subtle ambient sound.',
  },
  'komik-eglenceli': {
    id: 'komik-eglenceli',
    label: { tr: 'Komik / Eğlenceli', en: 'Funny / Playful' },
    desc: { tr: 'Mizah ve abartı ile dikkat çeker, viral potansiyel.', en: 'Humor and exaggeration grab attention; viral potential.' },
    hookStyle: 'comedic',
    scene:
      'Vertical video, comedic and exaggerated. An over-the-top funny scenario involving the product, expressive acting, playful timing, bright energetic look. First 2 seconds: an unexpected, humorous hook. Light, funny, shareable mood.',
  },
  'uzman-tavsiyesi': {
    id: 'uzman-tavsiyesi',
    label: { tr: 'Uzman Tavsiyesi', en: 'Expert Advice' },
    desc: { tr: 'Konunun uzmanı gibi görünen biri güven vererek anlatır.', en: 'A credible-looking expert explains with authority.' },
    hookStyle: 'authority',
    scene:
      'Vertical video, credible and clean look. A knowledgeable, trustworthy presenter in a professional-but-approachable setting explains why the product works. Steady camera, soft professional lighting, confident posture. First 2 seconds: an authority-building opener. Reassuring, expert tone.',
  },
  'once-sonra': {
    id: 'once-sonra',
    label: { tr: 'Önce–Sonra', en: 'Before–After' },
    desc: { tr: 'Dönüşüm/sonuç vurgusu (cilt, fitness, temizlik vb.).', en: 'Transformation/result emphasis (skin, fitness, cleaning, etc.).' },
    hookStyle: 'transformation',
    scene:
      'Vertical video showing a clear before-and-after transformation. First 2 seconds: the "before" state with a hook line. Then the product is introduced, transitioning to the improved "after" state. Handheld, natural light, honest framing. Convincing, results-driven mood.',
  },
};

const listStyles = () => Object.values(STYLES);
const getStyle = (id) => STYLES[id] || STYLES['samimi-itiraf'];
const styleIds = () => Object.keys(STYLES);
const defaultStyle = () => listStyles().find((s) => s.isDefault) || listStyles()[0];

module.exports = { STYLES, listStyles, getStyle, styleIds, defaultStyle };
