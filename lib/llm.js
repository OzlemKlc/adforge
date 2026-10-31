// lib/llm.js — Opsiyonel OpenAI Responses API istemcisi.
//
// AdForge yalnizca FAL_KEY ile calisir; OPENAI_API_KEY varsa hook uretimi ve
// skorlama LLM ile zenginlestirilir. PLANNER_MODE: auto | template | llm.
//
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MODE = (process.env.PLANNER_MODE || 'auto').toLowerCase();

function llmAvailable() {
  if (MODE === 'template') return false;
  if (MODE === 'llm') return !!OPENAI_API_KEY; // llm zorunlu ama anahtar yoksa yine de false
  return !!OPENAI_API_KEY; // auto
}

// system: string, user: string. json=true ise yaniti JSON.parse etmeyi dener.
async function callLLM(system, user, { maxTokens = 1024, json = false, temperature = 0.8 } = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY yok');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      temperature,
      instructions: system,
      input: user,
      ...(json ? { text: { format: { type: 'json_object' } } } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('OpenAI bos yanit dondu');
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

module.exports = { OPENAI_MODEL, MODE, llmAvailable, callLLM, parseJsonLoose };
