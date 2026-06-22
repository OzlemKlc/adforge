// lib/llm.js — Opsiyonel Anthropic (Claude) istemcisi.
//
// AdForge yalnizca FAL_KEY ile calisir; ANTHROPIC_API_KEY varsa hook uretimi ve
// skorlama LLM ile zenginlestirilir. PLANNER_MODE: auto | template | llm.
//
// Prompt caching: sistem promptu cache_control ile isaretlenir (tekrar cagrilarda
// ucuz/hizli). claude-api skill rehberine uygun.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MODE = (process.env.PLANNER_MODE || 'auto').toLowerCase();

function llmAvailable() {
  if (MODE === 'template') return false;
  if (MODE === 'llm') return !!ANTHROPIC_API_KEY; // llm zorunlu ama anahtar yoksa yine de false
  return !!ANTHROPIC_API_KEY; // auto
}

// system: string, user: string. json=true ise yaniti JSON.parse etmeyi dener.
async function callLLM(system, user, { maxTokens = 1024, json = false, temperature = 0.8 } = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY yok');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!json) return text;
  return parseJsonLoose(text);
}

// LLM bazen JSON'u ```json ... ``` icine sarar veya basina aciklama ekler — toparla.
function parseJsonLoose(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // ilk { veya [ ile son } veya ] arasini al
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

module.exports = { ANTHROPIC_MODEL, MODE, llmAvailable, callLLM, parseJsonLoose };
