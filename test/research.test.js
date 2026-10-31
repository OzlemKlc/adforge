'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeResearch, normalizeInput, detectAngles, orderAngles } = require('../lib/research');
const { templateHooks, ANGLE_KEYS } = require('../lib/planner');

test('detectAngles: Türkçe acı nokta + soru + sonuç', () => {
  const a = detectAngles('Gün boyu masada mı çalışıyorsun? Sırt ağrına son ver.');
  assert.ok(a.includes('question'));
  assert.ok(a.includes('pain'));
  assert.ok(a.includes('bold_result'));
});

test('detectAngles: "sırt" ve "zorunlu" yanlış pozitif vermez', () => {
  assert.ok(!detectAngles('Sırt çantası için ideal.').includes('curiosity'));
  assert.ok(!detectAngles('Kullanımı zorunlu değil.').includes('pain'));
  assert.ok(detectAngles('Bu işin sır kısmı burada.').includes('curiosity'));
});

test('detectAngles: Türkçe yüzde yazımı ve İngilizce', () => {
  assert.ok(detectAngles('%100 ışık geçirmez maske.').includes('bold_result'));
  assert.ok(detectAngles("I've been using this for a month.").includes('testimonial'));
  assert.deepEqual(detectAngles(''), []);
});

test('normalizeInput: düz metin satır satır, kısa satırlar atlanır', () => {
  const out = normalizeInput('Boyun ağrına 15 dakikada elveda.\nok\nHerkes bunu konuşuyor, sen de dene.');
  assert.equal(out.length, 2);
  assert.equal(out[0].weight, 1);
});

test('normalizeInput: Winning Product Finder arama çıktısı skorla ağırlıklandırılır', () => {
  const wpf = { items: [{ adCopy: 'Boyun ağrına elveda.', winningScore: 91 }, { adCopy: 'Odanı renge boya!', daysActive: 73 }] };
  const out = normalizeInput(wpf);
  assert.equal(out.length, 2);
  assert.equal(out[0].weight, 0.91);
  assert.equal(out[1].weight, 0.2);
});

test('normalizeInput: WPF UGC brifinden yalnızca gerçek reklam hook\'u alınır', () => {
  const brief = {
    hookOptions: [
      { type: 'original', text: 'Boyun ağrına 15 dakikada elveda.' },
      { type: 'question', text: 'Gerçekten işe yarıyor mu? Denedim.' },
    ],
    signals: { winningScore: 80 },
  };
  const out = normalizeInput(brief);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'Boyun ağrına 15 dakikada elveda.');
  assert.equal(out[0].weight, 0.8);
});

test('normalizeInput: JSON metin olarak gelirse çözülür, bozuk JSON düz metin sayılır', () => {
  assert.equal(normalizeInput(JSON.stringify({ items: [{ adCopy: 'Boyun ağrına elveda.' }] })).length, 1);
  assert.equal(normalizeInput('{ bozuk json ama yeterince uzun').length, 1);
});

test('analyzeResearch: açılar ağırlığa göre sıralanır, referanslar en güçlü reklamdan', () => {
  const r = analyzeResearch({
    items: [
      { adCopy: 'Sırt ağrısından bıktın mı? Bunu dene.', winningScore: 95 },
      { adCopy: 'Herkes bunu konuşuyor, en çok satan model.', winningScore: 40 },
      { adCopy: 'Herkes aldı, binlerce yorum var.', winningScore: 30 },
    ],
  });
  assert.equal(r.total, 3);
  assert.equal(r.angles[0].angle, 'pain');
  assert.equal(r.references[0].opener, 'Sırt ağrısından bıktın mı?');
  assert.deepEqual(analyzeResearch(''), { total: 0, angles: [], references: [] });
});

test('orderAngles: kanıtlanmış açılar önce, bilinmeyenler atlanır, hiçbiri kaybolmaz', () => {
  const order = orderAngles(ANGLE_KEYS, { angles: [{ angle: 'pain' }, { angle: 'unknown' }, { angle: 'question' }] });
  assert.deepEqual(order.slice(0, 2), ['pain', 'question']);
  assert.equal(order.length, ANGLE_KEYS.length);
  assert.deepEqual(new Set(order), new Set(ANGLE_KEYS));
});

test('planner şablonu: araştırma varsa ilk hook\'lar kanıtlanmış açılardan, referansla', () => {
  const research = analyzeResearch('Sırt ağrısından bıktın mı? Bunu dene.\nHerkes bunu konuşuyor, en çok satan model.');
  const hooks = templateHooks({ product: 'Masaj aleti', language: 'tr', count: 4, styleIds: ['x'], research });
  assert.equal(hooks[0].researchBacked, true);
  assert.ok(research.angles.map((a) => a.angle).includes(hooks[0].angle));
  assert.ok(hooks[0].reference);
  assert.equal(hooks[3].researchBacked, false);
});

test('planner şablonu: araştırma yoksa eski davranış korunur', () => {
  const hooks = templateHooks({ product: 'Masaj aleti', language: 'tr', count: 3, styleIds: ['x'] });
  assert.deepEqual(hooks.map((h) => h.angle), ANGLE_KEYS.slice(0, 3));
  assert.ok(hooks.every((h) => h.researchBacked === false && h.reference === null));
});

test('İngilizce "I" Türkçe küçük harfe çevrilince bozulmaz', () => {
  assert.ok(detectAngles('I tried everything. Nothing worked until this.').includes('testimonial'));
  assert.ok(detectAngles('I wish I knew this sooner.').includes('mistake'));
});
