'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMetrics, pickRealWinner, angleLearnings, MIN_IMPRESSIONS } = require('../lib/learnings');
const { heuristicScore, angleWeight, ANGLE_WEIGHT } = require('../lib/scorers/predicted');

const v = (id, angle, raw) => ({ id, hook: { angle }, real: computeMetrics(raw) });

test('computeMetrics: CTR, dönüşüm oranı, CPA; sıfıra bölmede null', () => {
  const m = computeMetrics({ impressions: 2000, clicks: 40, conversions: 4, spend: 100 });
  assert.equal(m.ctr, 0.02);
  assert.equal(m.cvr, 0.1);
  assert.equal(m.cpa, 25);
  assert.equal(m.enoughData, true);
  const z = computeMetrics({});
  assert.equal(z.ctr, null);
  assert.equal(z.cvr, null);
  assert.equal(z.cpa, null);
  assert.equal(z.enoughData, false);
});

test('computeMetrics: negatif / metin değerler 0 sayılır', () => {
  const m = computeMetrics({ impressions: '-5', clicks: 'abc' });
  assert.equal(m.impressions, 0);
  assert.equal(m.clicks, 0);
});

test('pickRealWinner: harcama varsa en düşük CPA kazanır', () => {
  const w = pickRealWinner([
    v('var_a', 'pain', { impressions: 5000, clicks: 100, conversions: 5, spend: 100 }), // CPA 20
    v('var_b', 'curiosity', { impressions: 5000, clicks: 300, conversions: 4, spend: 40 }), // CPA 10
  ]);
  assert.equal(w.variantId, 'var_b');
  assert.equal(w.basis, 'cpa');
});

test('pickRealWinner: dönüşüm yoksa CTR; yetersiz veri dışarıda', () => {
  const w = pickRealWinner([
    v('var_a', 'pain', { impressions: 5000, clicks: 100 }),
    v('var_b', 'curiosity', { impressions: 50, clicks: 40 }), // çok yüksek CTR ama az gösterim
  ]);
  assert.equal(w.variantId, 'var_a');
  assert.equal(w.basis, 'ctr');
  assert.equal(pickRealWinner([v('var_x', 'pain', { impressions: 10, clicks: 5 })]), null);
  assert.equal(pickRealWinner([]), null);
});

test('angleLearnings: kampanyalar arası toplar, en iyi açı 0.95, az veri ağırlık almaz', () => {
  const campaigns = [
    { variants: [v('var_a', 'pain', { impressions: 3000, clicks: 90 }), v('var_b', 'demo', { impressions: 3000, clicks: 30 })] },
    { variants: [v('var_c', 'pain', { impressions: 1000, clicks: 30 }), v('var_d', 'mistake', { impressions: 100, clicks: 50 })] },
  ];
  const { angles, weights } = angleLearnings(campaigns);
  const pain = angles.find((a) => a.angle === 'pain');
  assert.equal(pain.impressions, 4000);
  assert.equal(pain.ctr, 0.03);
  assert.equal(weights.pain, 0.95);
  assert.equal(weights.demo, 0.717);
  assert.equal(weights.mistake, undefined, `${MIN_IMPRESSIONS} gösterim altı açıya ağırlık verilmez`);
});

test('angleLearnings: sonuç yokken boş', () => {
  assert.deepEqual(angleLearnings([{ variants: [{ id: 'var_a', hook: { angle: 'pain' } }] }]).weights, {});
});

test('skorlayıcı: öğrenilmiş ağırlık > araştırma > varsayılan', () => {
  assert.deepEqual(angleWeight({ angle: 'demo' }, { demo: 0.6 }), { weight: 0.6, weightSource: 'learned' });
  assert.deepEqual(angleWeight({ angle: 'demo', researchBacked: true }), {
    weight: ANGLE_WEIGHT.demo + 0.05,
    weightSource: 'research',
  });
  assert.deepEqual(angleWeight({ angle: 'demo' }), { weight: ANGLE_WEIGHT.demo, weightSource: 'default' });
});

test('skorlayıcı: kendi verisi zayıf diyen açıya daha düşük skor verir', () => {
  const variant = { hook: { angle: 'curiosity', hookLine: 'Bunu kimse söylemiyor ama işe yarıyor.', script: 'Bunu kimse söylemiyor ama işe yarıyor. Linke bak.' } };
  const before = heuristicScore({ variant });
  const after = heuristicScore({ variant, learned: { curiosity: 0.6 } });
  assert.ok(after.value < before.value);
  assert.equal(after.breakdown.weightSource, 'learned');
  assert.match(after.reason, /öğrenildi/);
});
