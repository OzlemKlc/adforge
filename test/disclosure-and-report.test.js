'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAss, disclosureText } = require('../lib/captions');
const { buildLlmPrompt } = require('../lib/scorers/predicted');

const base = {
  words: [{ word: 'Boyun', start: 0.2, end: 0.6 }, { word: 'ağrına', start: 0.6, end: 1.1 }],
  sentences: [{ end: 1.1 }],
  hookLine: 'Boyun ağrına elveda',
  styleId: 'samimi-itiraf',
  videoDur: 12,
};

test('AI etiketi varsayılan olarak tüm video boyunca basılır (TR / EN)', () => {
  const tr = buildAss({ ...base, language: 'tr' });
  assert.match(tr, /Dialogue: 2,0:00:00\.00,0:00:12\.00,Disclosure,,0,0,0,,Yapay zeka ile üretilmiştir/);
  assert.match(buildAss({ ...base, language: 'en' }), /,Disclosure,,0,0,0,,AI-generated/);
});

test('AI etiketi: AI_DISCLOSURE=off kapatır, özel metin kullanılabilir', () => {
  const prev = process.env.AI_DISCLOSURE;
  try {
    process.env.AI_DISCLOSURE = 'off';
    assert.equal(disclosureText('tr'), null);
    assert.ok(!buildAss({ ...base }).includes('Dialogue: 2'));
    process.env.AI_DISCLOSURE = 'Bu video yapay zeka içerir';
    assert.equal(disclosureText('tr'), 'Bu video yapay zeka içerir');
  } finally {
    if (prev === undefined) delete process.env.AI_DISCLOSURE;
    else process.env.AI_DISCLOSURE = prev;
  }
});

test('LLM prompt: öğrenilmiş sonuçlar ve araştırma kanıtı prompta girer', () => {
  const variant = {
    avatarId: 'genc-kadin-dogal',
    hook: { angle: 'pain', styleId: 'samimi-itiraf', hookLine: 'Bıktın mı?', script: 'Bıktın mı? Linke bak.', researchBacked: true, reference: 'Sırt ağrısından bıktın mı?' },
  };
  const { user, system } = buildLlmPrompt({ variant, campaign: { brief: { product: 'X' } }, learned: { pain: 0.95, demo: 0.6 } });
  assert.match(user, /REAL ad results/);
  assert.match(user, /pain: 0\.95, demo: 0\.6/);
  assert.match(user, /proven in long-running competitor ads/);
  assert.match(system, /outweigh general intuition/);
});

test('LLM prompt: kanıt yoksa "Evidence" bloğu eklenmez', () => {
  const variant = { avatarId: 'genc-kadin-dogal', hook: { angle: 'demo', styleId: 'samimi-itiraf', hookLine: 'Bak', script: 'Bak.' } };
  const { user } = buildLlmPrompt({ variant, campaign: {}, learned: {} });
  assert.ok(!user.includes('Evidence'));
});
