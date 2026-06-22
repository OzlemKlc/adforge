// lib/demo.js — ANAHTARSIZ DEMO KAMPANYASI.
//
// fal.ai anahtari olmadan, ucretsiz, aninda dolan ornek bir kampanya uretir:
// sablon hook'lar + heuristik skorlar + sahte poster (paketteki saat fotograflari)
// + siralanmis performans raporu. Demo/sunum icin konsolu "dolu" gostermek icindir.

const store = require('./store');
const { templateHooks } = require('./planner');
const { pickAvatars } = require('./avatars');
const { getScorer } = require('./scorers');
const { buildReport } = require('./pipeline');
const { estimateCampaign } = require('./cost');

// TEK ürün: tüm varyantlar AYNI saatin farklı reklam versiyonu (kadraj/ton + avatar + hook farkı).
const PRODUCT = '/assets/products/watch-01.jpg';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function createDemoCampaign(opts = {}) {
  const language = opts.language === 'en' ? 'en' : 'tr';
  const product = (opts.product || '').trim() || (language === 'en' ? 'Aurora automatic watch' : 'Aurora otomatik saat');
  const benefit = (opts.benefit || '').trim() || (language === 'en' ? 'timeless design, everyday durability' : 'zamansız tasarım, günlük dayanıklılık');
  const styleIds = opts.styles && opts.styles.length ? opts.styles : ['samimi-itiraf', 'problem-cozum', 'heyecanli-kesif', 'luks-estetik'];

  const hooks = templateHooks({ product, benefit, brand: opts.brandName || '', language, count: 5, styleIds });
  const avatars = pickAvatars(2);
  const scorer = getScorer('predicted');
  const cost = estimateCampaign({ avatars: 2, hooks: 5, styleCount: styleIds.length, level: 'standart', duration: '8s' });

  const c = store.createCampaign({
    brand: { name: (opts.brandName || '').trim() || (language === 'en' ? 'Demo Brand' : 'Demo Markası'), language },
    brief: { product, benefit, audience: '', tone: '' },
    config: { avatars: 2, hooks: 5, styles: styleIds, level: 'standart', duration: '8s', engine: 'veo' },
    productImageUrl: PRODUCT,
    cost: { estimated: cost.total, actual: 0 },
  });
  store.updateCampaign(c.id, { demo: true, status: 'completed', scorer: 'predicted', costDetail: cost });

  // Demoyu gercek A/B verisi gibi gostermek icin genis, avatar-bazinda farklilasan
  // bir dagilim: hook kalitesi (heuristik) + avatar performans farki + hafif sapma.
  const AVATAR_BONUS = [7, -5, 2, -8, -12]; // avatar bazinda "donusum" farki (demo; ilk 2 -> 2 avatar)
  const variants = [];
  let i = 0;
  for (const hook of hooks) {
    avatars.forEach((avatar, ai) => {
      const v = {
        id: store.newId('var_'),
        avatarId: avatar.id, avatarLabel: avatar.label,
        hookId: hook.id, hook, engine: 'veo',
        status: 'completed', isDemo: true,
        posterUrl: PRODUCT, treat: i % 6,
        videoUrl: null, subtitledUrl: null, transcription: null,
        score: null, error: null,
      };
      const base = scorer.heuristicScore({ variant: v });
      const jitter = Math.round((Math.random() * 7) - 3);
      const value = clamp(Math.round(38 + base.value * 0.5 + AVATAR_BONUS[ai % AVATAR_BONUS.length] + jitter), 0, 98);
      v.score = { ...base, value };
      variants.push(v);
      i++;
    });
  }
  store.addVariants(c.id, variants);
  buildReport(c.id);
  return store.readCampaign(c.id);
}

module.exports = { createDemoCampaign, PRODUCT };
