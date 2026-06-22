// lib/fal.js — fal.ai REST API helper'lari (MCP'siz, dogrudan queue.fal.run).
//
// Eski mini-app'teki iki bug burada duzeltildi:
//   - Bug C: status/result URL'leri yeniden insa edilmiyor; submit yanitindaki
//     status_url / response_url dogrudan kullaniliyor (fal'in resmi yontemi).
//   - Bug B: altyazi gibi sema-hassas cagrilarda 422 alinirsa parametreler
//     kademeli olarak sadelestirilip yeniden deneniyor (submitWithFallback).

const fs = require('fs');

const FAL_KEY = process.env.FAL_KEY;
const QUEUE_BASE = 'https://queue.fal.run';

function authHeaders(extra = {}) {
  return { Authorization: `Key ${FAL_KEY}`, ...extra };
}

// Gecici ag hatalarina (fetch failed / ECONNRESET) karsi tekrar denemeli fetch.
async function rfetch(url, opts, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      last = e;
      await sleep(1500 * (i + 1)); // 1.5s, 3s, 4.5s...
    }
  }
  throw new FalError(`ag hatasi (tekrarlar tukendi): ${last && last.message}`, { status: 0, kind: 'http' });
}

// Hata sinifi: fal'in iki bilinen davranisini ayirir.
class FalError extends Error {
  constructor(message, { status, kind, body } = {}) {
    super(message);
    this.name = 'FalError';
    this.status = status;       // HTTP kodu
    this.kind = kind;           // 'rejected' | 'mcp_error' | 'auth' | 'http'
    this.body = body;
  }
}

// Bir is kuyruga gonder. Donen { request_id, status_url, response_url } saklanmali.
async function submit(endpoint, payload) {
  const res = await rfetch(`${QUEUE_BASE}/${endpoint}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new FalError('fal: yetkisiz (401). FAL_KEY gecersiz/eksik.', { status: 401, kind: 'auth', body: text });
    if (res.status === 422) throw new FalError(`fal 422 (reddedildi/gecersiz): ${falDetail(text)}`, { status: 422, kind: 'rejected', body: text.slice(0, 400) });
    throw new FalError(`fal submit ${res.status}: ${text.slice(0, 300)}`, { status: res.status, kind: 'http', body: text });
  }
  return JSON.parse(text); // { request_id, status_url, response_url, cancel_url }
}

// 422 alinirsa parametre setini kademeli sadelestirerek yeniden dener.
// variants: en zenginden en yaline dogru sirali payload listesi.
async function submitWithFallback(endpoint, variants) {
  let lastErr;
  for (const payload of variants) {
    try {
      return await submit(endpoint, payload);
    } catch (e) {
      lastErr = e;
      if (e instanceof FalError && e.status === 422) continue; // bir sonraki (daha yalin) payload'u dene
      throw e; // 401/500/diger: yeniden denemenin anlami yok
    }
  }
  throw lastErr;
}

// Submit yaniti elimizde olsun ya da olmasin durum sorgula.
async function status(job) {
  const url = job.statusUrl || `${QUEUE_BASE}/${baseId(job.endpoint)}/requests/${job.requestId}/status`;
  const res = await rfetch(url, { headers: authHeaders() });
  if (!res.ok) throw new FalError(`fal status ${res.status}`, { status: res.status, kind: 'http' });
  return res.json(); // { status: IN_QUEUE | IN_PROGRESS | COMPLETED | ... }
}

// Sonucu cek. fal'in iki ozel davranisini siniflandirir.
async function result(job) {
  const url = job.responseUrl || `${QUEUE_BASE}/${baseId(job.endpoint)}/requests/${job.requestId}`;
  const res = await rfetch(url, { headers: authHeaders() });
  if (res.ok) {
    const body = await res.json();
    // fal bazen 200 doner ama govde dogrulama hatasi icerir (video yok)
    if (body && body.detail && !body.video) {
      throw new FalError(`Reddedildi (gecersiz parametre): ${falDetail(body)}`, { status: 422, kind: 'rejected', body });
    }
    return body;
  }
  const text = await res.text();
  if (res.status === 422) {
    // status COMPLETED gorunse bile prompt reddedildi; para kesilmedi.
    throw new FalError(`Reddedildi (422, para kesilmedi): ${falDetail(text)}`, { status: 422, kind: 'rejected', body: text.slice(0, 400) });
  }
  if (res.status === 500) {
    // Video uretildi & faturalandi ama MCP/payload donduremiyor — dashboard'da hazir.
    throw new FalError('Video uretildi ama sonuc cekilemedi (fal 500). fal.ai/dashboard/requests adresinden URL alinabilir.', { status: 500, kind: 'mcp_error', body: text.slice(0, 400) });
  }
  throw new FalError(`fal result ${res.status}: ${text.slice(0, 300)}`, { status: res.status, kind: 'http', body: text });
}

// Submit -> poll -> result tek akista. job nesnesi { endpoint, requestId, statusUrl, responseUrl }.
async function runToCompletion(endpoint, payload, { pollMs = 6000, maxPolls = 120, onState } = {}) {
  const sub = await submit(endpoint, payload);
  const job = { endpoint, requestId: sub.request_id, statusUrl: sub.status_url, responseUrl: sub.response_url };
  return pollJob(job, { pollMs, maxPolls, onState });
}

async function pollJob(job, { pollMs = 6000, maxPolls = 120, onState } = {}) {
  for (let i = 0; i < maxPolls; i++) {
    const st = await status(job);
    if (st.status === 'COMPLETED') {
      const body = await result(job);
      return { job, body };
    }
    if (st.status === 'IN_QUEUE' || st.status === 'IN_PROGRESS') {
      if (onState) onState(st.status);
      await sleep(pollMs);
      continue;
    }
    throw new FalError(`Beklenmeyen durum: ${st.status}`, { status: 0, kind: 'http', body: st });
  }
  throw new FalError('Zaman asimi: is hala tamamlanmadi.', { status: 0, kind: 'http' });
}

// Dosyayi fal CDN'e yukle, kalici URL don.
async function upload(filePath, mimeType, fileName) {
  const initRes = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ file_name: fileName, content_type: mimeType }),
  });
  if (!initRes.ok) throw new FalError(`fal upload initiate ${initRes.status}`, { status: initRes.status, kind: 'http' });
  const { upload_url, file_url } = await initRes.json();
  const buffer = fs.readFileSync(filePath);
  const putRes = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: buffer });
  if (!putRes.ok) throw new FalError(`fal upload PUT ${putRes.status}`, { status: putRes.status, kind: 'http' });
  return file_url;
}

// "fal-ai/veo3.1/fast/image-to-video" -> "fal-ai/veo3.1" (yalnizca fallback URL insasinda)
function baseId(endpoint) {
  return endpoint.split('/').slice(0, 2).join('/');
}

// fal hata govdesinden okunabilir mesaj cikar (detail: [{msg}] | string).
function falDetail(input) {
  try {
    const j = typeof input === 'string' ? JSON.parse(input) : input;
    const d = j.detail;
    if (Array.isArray(d)) return d.map((x) => x.msg || x.message || JSON.stringify(x)).join('; ').slice(0, 250);
    if (typeof d === 'string') return d.slice(0, 250);
    return JSON.stringify(j).slice(0, 250);
  } catch {
    return String(input).slice(0, 250);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { FAL_KEY, FalError, submit, submitWithFallback, status, result, runToCompletion, pollJob, upload, baseId, sleep };
