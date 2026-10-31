// lib/learnings.js — OGRENME DONGUSU (test -> ogrenme -> bir sonraki kampanya).
//
// Varyantlar yayina girdikten sonra gercek sonuclar (Meta/TikTok reklam yoneticisindeki
// rakamlar) rapordaki tabloya elle ya da POST /api/campaigns/:id/results ile girilir.
// (Otomatik cekme: yol haritasindaki lib/scorers/platform.js.) Bu modul:
//   1) Varyant metriklerini hesaplar (CTR, donusum orani, CPA)
//   2) GERCEK kazanani secer (tahmini skor degil)
//   3) Tum kampanyalardan aci bazinda ogrenir ve skorlayiciya "ogrenilmis aci agirligi" verir
//
// Boylece predicted/heuristic skorlayicidaki elle yazilmis ANGLE_WEIGHT tablosu,
// yeterli veri biriktikce markanin KENDI verisiyle yer degistirir.
//
// Kucuk orneklem korumasi: MIN_IMPRESSIONS altindaki varyant/aci karar disi kalir
// (tek bir sansli varyant butun stratejiyi yonlendirmesin).

const MIN_IMPRESSIONS = parseInt(process.env.LEARN_MIN_IMPRESSIONS || '1000', 10);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const round = (n, d = 4) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Ham sonuc satirindan metrikleri hesaplar. Bolme hatalarinda null doner. */
function computeMetrics(raw = {}) {
  const impressions = num(raw.impressions);
  const clicks = num(raw.clicks);
  const conversions = num(raw.conversions);
  const spend = num(raw.spend);
  return {
    impressions,
    clicks,
    conversions,
    spend,
    ctr: impressions ? round(clicks / impressions) : null,
    cvr: clicks ? round(conversions / clicks) : null,
    cpa: conversions ? round(spend / conversions, 2) : null,
    enoughData: impressions >= MIN_IMPRESSIONS,
  };
}

/**
 * Gercek kazanani secer. Oncelik: donusum varsa en dusuk CPA (harcama yoksa en yuksek
 * donusum/gosterim), yoksa en yuksek CTR. Yetersiz veri olanlar disarida.
 * @param {Array<{id, real}>} variants
 */
function pickRealWinner(variants = []) {
  const eligible = variants.filter((v) => v.real && v.real.enoughData);
  if (!eligible.length) return null;

  const withConv = eligible.filter((v) => v.real.conversions > 0);
  let winner;
  let basis;
  if (withConv.length) {
    const hasSpend = withConv.every((v) => v.real.spend > 0);
    if (hasSpend) {
      winner = [...withConv].sort((a, b) => a.real.cpa - b.real.cpa)[0];
      basis = 'cpa';
    } else {
      const rate = (v) => v.real.conversions / v.real.impressions;
      winner = [...withConv].sort((a, b) => rate(b) - rate(a))[0];
      basis = 'conversionRate';
    }
  } else {
    winner = [...eligible].sort((a, b) => (b.real.ctr || 0) - (a.real.ctr || 0))[0];
    basis = 'ctr';
  }
  return { variantId: winner.id, angle: winner.hook?.angle || null, basis, metrics: winner.real };
}

/**
 * Tum kampanyalardaki gercek sonuclardan aci bazinda performans cikarir.
 * Agirlik: acinin CTR'i, en iyi acinin CTR'ina gore 0.60..0.95 araligina olceklenir
 * (predicted.js'teki elle tablo ile ayni aralik -> karisik kullanimda tutarli).
 * @returns {{ angles: Array<{angle, impressions, clicks, ctr, variants}>, weights: Object<string,number> }}
 */
function angleLearnings(campaigns = []) {
  const acc = {};
  for (const c of campaigns) {
    for (const v of c.variants || []) {
      if (!v.real || !v.hook?.angle) continue;
      const a = v.hook.angle;
      acc[a] = acc[a] || { impressions: 0, clicks: 0, conversions: 0, variants: 0 };
      acc[a].impressions += v.real.impressions;
      acc[a].clicks += v.real.clicks;
      acc[a].conversions += v.real.conversions;
      acc[a].variants += 1;
    }
  }
  const angles = Object.entries(acc)
    .map(([angle, x]) => ({
      angle,
      impressions: x.impressions,
      clicks: x.clicks,
      conversions: x.conversions,
      variants: x.variants,
      ctr: x.impressions ? round(x.clicks / x.impressions) : null,
      enoughData: x.impressions >= MIN_IMPRESSIONS,
    }))
    .sort((a, b) => (b.ctr || 0) - (a.ctr || 0));

  const qualified = angles.filter((a) => a.enoughData && a.ctr != null);
  const best = qualified.length ? Math.max(...qualified.map((a) => a.ctr)) : 0;
  const weights = {};
  if (best > 0) {
    for (const a of qualified) weights[a.angle] = round(0.6 + 0.35 * (a.ctr / best), 3);
  }
  return { angles, weights, minImpressions: MIN_IMPRESSIONS };
}

module.exports = { computeMetrics, pickRealWinner, angleLearnings, MIN_IMPRESSIONS };
