#!/usr/bin/env node
// Gateway probe: what each model route on the TrueFoundry gateway really supports,
// and how fast and reliable it is. Node >= 20, no dependencies.
//
// Run from blender-playground/ (the key comes from the environment only):
//   zsh -c 'source ~/.config/truefoundry/env && node ai/research/probe.mjs [options]'
//
// Options
//   --phase <p>[,<p>...]           full = deep matrix for ~37 chosen routes (default list below)
//                                  throttle = tiny calls at 1/2/4 in flight: the gateway's admission delay
//                                  sweep = 3 cheap calls on every chat route of the families we care about
//                                  clean = latency with strictly one request in flight (shortlist)
//                                  report = rewrite gateway-probe.md from gateway-probe.json (no calls)
//                                  all (default) = full, throttle, sweep, clean, report
//   --models a,b,c                 use these model ids instead of the phase's default list
//   --tests t1,t2                  full phase: run only these tests (the token-param tests always run)
//   --trials N                     latency trials per mode (default 3)
//   --concurrency N                max concurrent requests (default 4; hard cap 4, be gentle)
//   --out path                     JSON output (default ai/research/gateway-probe.json)
//   --fresh                        start a new JSON instead of merging into the existing one
//   --transport https|fetch        https (default) = node:https, HTTP/1.1, one keep-alive socket per in-flight request.
//                                  fetch = Node's built-in fetch (undici 8 negotiates HTTP/2 with this gateway and puts
//                                  every request on ONE connection, where the gateway serves them one after another:
//                                  measured ~1.5 s extra per call at 4 in flight vs ~45 ms over HTTP/1.1; see --phase throttle)
//   --dry                          print the plan and exit (no calls)
//
// Safety: the key is read from process.env.TRUEFOUNDRY_API_KEY, sent only in the Authorization
// header to TRUEFOUNDRY_BASE_URL, and never printed, logged or written. Request headers are never
// recorded; of the response headers only rate-limit, routing, timing and cache headers are kept,
// and every stored string is scrubbed of the key.

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ASSETS = path.join(HERE, 'probe-assets');
const KEY = process.env.TRUEFOUNDRY_API_KEY || '';
const BASE = (process.env.TRUEFOUNDRY_BASE_URL || 'https://tfy.promptlens.trilogy.com/v1').replace(/\/+$/, '');
const CATALOG_URL = 'http://localhost:8790/api/catalog';

// ---------------------------------------------------------------- options
function parseArgs(argv) {
  const o = { phase: 'all', trials: 3, concurrency: 4, out: path.join(HERE, 'gateway-probe.json'), fresh: false, dry: false, transport: 'https' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--phase') o.phase = next();
    else if (a === '--models') o.models = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--tests') o.tests = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--trials') o.trials = Math.max(1, parseInt(next(), 10) || 3);
    else if (a === '--concurrency') o.concurrency = Math.min(4, Math.max(1, parseInt(next(), 10) || 4));
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--dry') o.dry = true;
    else if (a === '--transport') o.transport = next() === 'fetch' ? 'fetch' : 'https';
    else { console.error('unknown option ' + a); process.exit(2); }
  }
  return o;
}
const OPT = parseArgs(process.argv.slice(2));
const MD_OUT = OPT.out.replace(/\.json$/, '') + '.md';

// ---------------------------------------------------------------- model lists
// Deep matrix: every family the AI scene builder could use, with route comparisons for the
// models most likely to be picked (Opus/Sonnet/Haiku/Fable 5.x, Gemini 4, GPT-6.1, Grok 4.7).
const FULL_MODELS = [
  // Claude Opus 5.5 — route comparison
  'claude-group/claude-opus-5-5',
  'anthropic-primary/claude-opus-5-5',
  'aws-bedrock/global.anthropic.claude-opus-5-5',
  'aws-bedrock/us.anthropic.claude-opus-5-5',
  'claude-opus-5-5',
  // older Opus
  'claude-group/claude-opus-5',
  'claude-group/claude-opus-4-8',
  // Sonnet
  'claude-group/claude-sonnet-5-5',
  'anthropic-primary/claude-sonnet-5-5',
  'aws-bedrock/global.anthropic.claude-sonnet-5-5',
  'claude-group/claude-sonnet-5',
  'claude-group/claude-sonnet-4-6',
  // Haiku
  'claude-group/claude-haiku-5-5',
  'anthropic-primary/claude-haiku-5-5',
  'claude-group/claude-haiku-4-5',
  'aws-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1-0',
  // Fable
  'claude-group/claude-fable-5-1',
  'anthropic-primary/claude-fable-5-1',
  'claude-group/claude-fable-5',
  // Gemini
  'gemini-group/gemini-4-argon',
  'gemini-primary/gemini-4-argon',
  'gemini-group/gemini-3.1-pro',
  'gemini-primary/gemini-3.1-pro-preview',
  'gemini-group/gemini-3.8-flash',
  'gemini-primary/gemini-3.8-flash',
  'gemini-group/gemini-3.5-flash-lite',
  // GPT
  'openai-group/gpt-6.1-sol',
  'openai-primary/gpt-6.1-sol',
  'openai-group/gpt-6-sol',
  'openai-group/gpt-6-astra',
  'openai-group/gpt-6-luna',
  'openai-group/gpt-5.5',
  'openai-group/gpt-5.4-mini',
  // Grok
  'xai-group/grok-4.7',
  'xai-primary/grok-4.7',
  // Qwen3-VL
  'bedrock-oss-group/qwen3-vl-235b',
  'aws-bedrock/qwen.qwen3-vl-235b-a22b',
];

function sweepModels() {
  const ids = JSON.parse(fs.readFileSync(path.join(HERE, 'gateway-models.json'), 'utf8')).ids;
  const want = /claude|gemini|gpt-[56]|grok|qwen3-vl/i;
  // not chat models, or other teams' dedicated allocations (academics/esw/contract-analyzer) we should not build on
  const skip = /tts|embed|image-preview|transcribe|search-api|^(openai-academics|openai-esw|openai-group-academics|openai-group-esw|vertex-contract-analyzer)\//i;
  return ids.filter(id => want.test(id) && !skip.test(id));
}

// ---------------------------------------------------------------- helpers
const round = x => (x == null ? null : Math.round(x));
const nonce = () => crypto.randomBytes(4).toString('hex');
const tag = n => `\n\n[probe ${n}]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function scrub(s) {
  let t = String(s ?? '');
  if (KEY && KEY.length > 6) t = t.split(KEY).join('[redacted]');
  return t.replace(/Bearer\s+[A-Za-z0-9._\-~+/=]{8,}/gi, 'Bearer [redacted]');
}

function median(xs) {
  const v = xs.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function textOf(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

function parseJsonLoose(s) {
  const raw = (s || '').trim();
  try { return { value: JSON.parse(raw), raw: true }; } catch { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return { value: JSON.parse(fenced[1].trim()), raw: false, how: 'fence' }; } catch { /* */ } }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return { value: JSON.parse(raw.slice(a, b + 1)), raw: false, how: 'braces' }; } catch { /* */ } }
  return { value: undefined, raw: false };
}

// Minimal JSON-schema check for the probe's own schemas (object/array/string/number/integer/boolean, enum, required, additionalProperties:false).
function validate(schema, v, at = '$') {
  const errs = [];
  const t = schema.type;
  const typeOk =
    t === 'object' ? v && typeof v === 'object' && !Array.isArray(v) :
    t === 'array' ? Array.isArray(v) :
    t === 'string' ? typeof v === 'string' :
    t === 'number' ? typeof v === 'number' :
    t === 'integer' ? Number.isInteger(v) :
    t === 'boolean' ? typeof v === 'boolean' : true;
  if (!typeOk) return [`${at}: expected ${t}`];
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${at}: not in enum`);
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${at}.${k}: missing`);
    for (const k of Object.keys(v)) {
      if (schema.properties?.[k]) errs.push(...validate(schema.properties[k], v[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: extra`);
    }
  }
  if (t === 'array' && schema.items) v.forEach((x, i) => errs.push(...validate(schema.items, x, `${at}[${i}]`)));
  return errs;
}

function dataUrl(file) {
  return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ASSETS, file)).toString('base64');
}
const img = url => ({ type: 'image_url', image_url: { url } });

// canonical model name: strips route prefix, region, vendor prefix, dates and version suffixes
function canonical(id) {
  let n = id.split('/').pop();
  n = n.replace(/^(global|us|eu)\./, '').replace(/^(anthropic|qwen)\./, '');
  n = n.replace(/-v\d+(-\d+)?$/, '').replace(/-20\d{6}$/, '').replace(/-(azure|preview|a22b|flex)$/, '').replace(/-20\d{6}$/, '');
  n = n.replace(/^claude-4-(opus|sonnet)/, 'claude-$1-4');
  return n;
}
const routeOf = id => (id.includes('/') ? id.split('/')[0] + (/\/(global|us|eu)\./.test(id) ? '/' + id.split('/')[1].split('.')[0] : '') : '(bare)');

// ---------------------------------------------------------------- concurrency + HTTP
class Sem {
  constructor(n) { this.n = n; this.q = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise(r => this.q.push(r)); }
  release() { const r = this.q.shift(); if (r) r(); else this.n++; }
}
const sem = new Sem(OPT.concurrency);

function readHeaders(h, rec) {
  const rl = {};
  for (const [k, v] of h) if (/ratelimit|rate-limit|retry-after/i.test(k)) rl[k] = scrub(v);
  if (Object.keys(rl).length) rec.ratelimit = rl;
  const st = h.get('server-timing');
  if (st) {
    const mc = st.match(/model-call;dur=([\d.]+)/), tt = st.match(/total;dur=([\d.]+)/);
    if (mc) rec.ms_model_call = round(+mc[1]);
    if (tt) rec.ms_gateway_total = round(+tt[1]);
  }
  const ar = h.get('x-tfy-applied-rules');
  if (ar) {
    try {
      const j = JSON.parse(ar);
      if (j.routing_config) {
        rec.resolved_model = j.routing_config.resolved_model;
        rec.routing_order = (j.routing_config.routing_model_order || []).map(x => x.model);
      }
      if (j.budget_limiting?.violated) rec.budget_violated = true;
    } catch { /* ignore */ }
  }
  const cl = h.get('x-tfy-model-context-length'); if (cl) rec.context_length = +cl;
  const cs = h.get('x-tfy-cache-status'); if (cs) rec.gateway_cache = cs;
  const pm = h.get('openai-processing-ms'); if (pm) rec.ms_provider_processing = +pm;
}

function errKind(status) {
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout_upstream';
  if (status >= 500) return 'server';
  return 'client';
}

function errMessage(txt) {
  let m = txt;
  try {
    const j = JSON.parse(txt);
    m = j.error?.message || j.message || j.detail || JSON.stringify(j);
    if (typeof m !== 'string') m = JSON.stringify(m);
  } catch { /* raw text */ }
  return scrub(m).replace(/\s+/g, ' ').slice(0, 400);
}

function fromMessage(rec, j) {
  const ch = j.choices?.[0];
  const m = ch?.message || {};
  rec.content = textOf(m.content);
  let reasoning = '';
  if (typeof m.reasoning_content === 'string') reasoning += m.reasoning_content;
  else if (typeof m.reasoning === 'string') reasoning += m.reasoning;
  if (Array.isArray(m.thinking_blocks)) {
    rec.thinking_blocks = m.thinking_blocks.length;
    if (!reasoning) reasoning = m.thinking_blocks.map(b => b.thinking || '').join('');
  }
  rec.reasoning_chars = reasoning.length;
  rec.tool_calls = (m.tool_calls || []).map(tc => ({ name: tc.function?.name, arguments: tc.function?.arguments }));
  rec.finish_reason = ch?.finish_reason ?? null;
  rec.model_returned = j.model;
  if (j.provider) rec.provider = j.provider;
  rec.usage = j.usage || null;
  if (m.refusal) rec.refusal = scrub(m.refusal).slice(0, 200);
}

async function readStream(r, rec, t0) {
  const dec = new TextDecoder();
  let buf = '', content = '', reasoning = '', firstAny = null, firstContent = null, chunks = 0;
  const tools = [];
  const onLine = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { rec.done = true; return; }
    let j;
    try { j = JSON.parse(data); } catch { rec.stream_parse_errors = (rec.stream_parse_errors || 0) + 1; return; }
    chunks++;
    if (j.error) { rec.error = { kind: 'stream', message: errMessage(JSON.stringify(j)) }; return; }
    if (j.model && !rec.model_returned) rec.model_returned = j.model;
    if (j.provider) rec.provider = j.provider;
    if (j.usage) rec.usage = j.usage;
    const ch = j.choices?.[0];
    if (!ch) return;
    const d = ch.delta || {};
    const t = performance.now() - t0;
    const dc = textOf(d.content);
    let dr = '';
    if (typeof d.reasoning_content === 'string') dr = d.reasoning_content;
    else if (typeof d.reasoning === 'string') dr = d.reasoning;
    else if (Array.isArray(d.thinking_blocks)) dr = d.thinking_blocks.map(b => b.thinking || '').join('');
    if (dc) { content += dc; if (firstContent == null) firstContent = t; }
    if (dr) reasoning += dr;
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const k = tc.index ?? 0;
        tools[k] ||= { name: '', arguments: '' };
        if (tc.function?.name) tools[k].name += tc.function.name;
        if (tc.function?.arguments) tools[k].arguments += tc.function.arguments;
      }
    }
    if ((dc || dr || d.tool_calls) && firstAny == null) firstAny = t;
    if (ch.finish_reason) rec.finish_reason = ch.finish_reason;
  };
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) onLine(buf.trim());
  rec.ms_total = round(performance.now() - t0);
  rec.ms_first_token = round(firstAny);
  rec.ms_first_content = round(firstContent);
  rec.content = content;
  rec.reasoning_chars = reasoning.length;
  rec.tool_calls = tools.filter(Boolean);
  rec.chunks = chunks;
}

let CALLS = 0;
// HTTP/1.1 POST with a keep-alive agent: each in-flight request gets its own socket.
const AGENT = new https.Agent({ keepAlive: true, maxSockets: 8 });
function postHttps(url, payload, signal) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', agent: AGENT,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, 'content-length': Buffer.byteLength(payload) },
    }, res => {
      const h = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) { try { h.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* odd header */ } }
      resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: h, body: res,
        text: async () => { let t = ''; for await (const c of res) t += c; return t; },
      });
    });
    req.on('error', reject);
    const abort = () => req.destroy(new Error('aborted'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    req.end(payload);
  });
}

async function call(model, body, { stream = false, timeoutMs = 120000, transport = OPT.transport } = {}) {
  const req = { model, ...body };
  if (stream) { req.stream = true; if (req.stream_options === undefined) req.stream_options = { include_usage: true }; }
  const payload = JSON.stringify(req);
  await sem.acquire();
  CALLS++;
  const rec = { at: new Date().toISOString(), stream, req_bytes: payload.length, transport };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = transport === 'fetch'
      ? await fetch(BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: payload,
        signal: ctl.signal,
      })
      : await postHttps(BASE + '/chat/completions', payload, ctl.signal);
    rec.ms_ttfb = round(performance.now() - t0);
    rec.status = r.status;
    readHeaders(r.headers, rec);
    // time spent outside the gateway's own processing (queueing on the connection + network + TLS)
    if (rec.ms_gateway_total != null) rec.ms_overhead = Math.max(0, rec.ms_ttfb - rec.ms_gateway_total);
    if (!r.ok) {
      const txt = await r.text();
      rec.ms_total = round(performance.now() - t0);
      rec.error = { kind: errKind(r.status), message: errMessage(txt) };
      const ra = r.headers.get('retry-after');
      if (ra) rec.retry_after = ra;
    } else if (stream && /event-stream/i.test(r.headers.get('content-type') || '')) {
      await readStream(r, rec, t0);
    } else {
      const txt = await r.text();
      rec.ms_total = round(performance.now() - t0);
      if (stream) rec.stream_returned_json = true;
      let j;
      try { j = JSON.parse(txt); } catch { rec.error = { kind: 'parse', message: scrub(txt).slice(0, 200) }; }
      if (j) {
        if (j.error && !j.choices) rec.error = { kind: 'body_error', message: errMessage(txt) };
        else fromMessage(rec, j);
      }
    }
  } catch (e) {
    rec.ms_total = round(performance.now() - t0);
    rec.error = ctl.signal.aborted
      ? { kind: 'timeout', message: `no complete response within ${timeoutMs} ms` }
      : { kind: 'network', message: scrub(e?.cause?.code || e?.message || String(e)).slice(0, 200) };
  } finally {
    clearTimeout(timer);
    sem.release();
  }
  rec.ok = !rec.error;
  return rec;
}

// Retries once after a 429 / 5xx / network blip so a feature test is still answered;
// both attempts are kept so error rates stay honest.
async function callWithRetry(model, body, opts) {
  const first = await call(model, body, opts);
  if (first.ok || !['rate_limit', 'server', 'network', 'timeout_upstream'].includes(first.error?.kind)) return { rec: first, attempts: [first] };
  const wait = first.error.kind === 'rate_limit' ? Math.min(30000, (parseFloat(first.retry_after) || 10) * 1000) : 3000;
  await sleep(wait);
  const second = await call(model, body, opts);
  second.retry_of = first.error.kind;
  return { rec: second, attempts: [first, second] };
}

// ---------------------------------------------------------------- prompts + fixtures
let DIGEST = null, CATALOG_KEYS = null, IMAGES = null;

async function loadFixtures() {
  const f = path.join(ASSETS, 'catalog-digest.txt');
  if (!fs.existsSync(f)) {
    const r = await fetch(CATALOG_URL);
    if (!r.ok) throw new Error('catalog fetch failed: ' + r.status);
    const cat = await r.json();
    // compact on purpose (~6k tokens): material-derived surface props (bounce/friction/rolling/side) are
    // listed once under MATERIALS instead of on every type; numbers rounded to 4 significant digits
    const num = x => (typeof x === 'number' ? +x.toPrecision(4) : x);
    const lines = [];
    for (const t of cat.types) {
      const props = (t.props || []).filter(p => !['bounce', 'friction', 'rolling', 'side'].includes(p.key)).map(p => {
        if (p.kind === 'number') return `${p.key}=${num(p.default)}${p.unit ? p.unit : ''} [${num(p.min)}..${num(p.max)}]`;
        if (p.kind === 'choice') return p.key === 'material' ? `material=${p.default}` : `${p.key}=${p.default} {${(p.choices || []).join('|')}}`;
        return `${p.key}=${JSON.stringify(p.default)}`;
      }).join('; ');
      const first = (t.description || '').split(/(?<=\.)\s/)[0].slice(0, 90);
      lines.push(`${t.key} — ${t.name} (${t.category}${t.dynamic === false ? ', static' : ''}). ${first} Props: ${props}`);
    }
    const mats = Object.entries(cat.materials || {}).map(([k, m]) => `${k}: ${m.density} kg/m3, bounce ${m.bounce}, friction ${m.friction}`);
    // budget ≈ 6k tokens (measured: ~2.1 chars/token on Claude 5.x, ~2.9 on GPT-5.4, ~2.6 on Gemini 3.8)
    const BUDGET = 15500;
    let text = 'CATALOG (type key — name (category). summary. props as key=default [min..max])\n';
    for (const l of lines) { if (text.length + l.length > BUDGET - 1200) break; text += l + '\n'; }
    text += '\nMATERIALS\n' + mats.join('\n') + '\n';
    fs.writeFileSync(f, text);
  }
  DIGEST = fs.readFileSync(f, 'utf8');
  CATALOG_KEYS = new Set(DIGEST.split('\n').map(l => l.split(' — ')[0]).filter(k => /^[a-z0-9_-]+$/i.test(k)));
  IMAGES = {
    a: dataUrl('shapes-a-1536.jpg'), b: dataUrl('shapes-b-1536.jpg'), c: dataUrl('shapes-c-1536.jpg'),
    d: dataUrl('shapes-d-1536.jpg'), a512: dataUrl('shapes-a-512.jpg'), scene: dataUrl('scene-1536.jpg'),
    heavy: dataUrl('heavy-1536.jpg'),
  };
}

const TINY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'items'],
  properties: {
    title: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'x_m', 'fixed'],
        properties: { type: { type: 'string', enum: ['ball', 'ramp', 'domino', 'cup'] }, x_m: { type: 'number' }, fixed: { type: 'boolean' } },
      },
    },
  },
};
const PLACE_TOOL = {
  type: 'function',
  function: {
    name: 'place_item',
    description: 'Place one catalog item on the table.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['type', 'x_m', 'fixed'],
      properties: { type: { type: 'string', enum: ['ball', 'ramp', 'domino', 'cup'] }, x_m: { type: 'number', description: 'metres along the table' }, fixed: { type: 'boolean' } },
    },
  },
};
const REMOVE_TOOL = {
  type: 'function',
  function: {
    name: 'remove_item',
    description: 'Remove one item from the scene by id.',
    parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  },
};
const PHYS_Q = 'A 0.2 kg ball rolls off a table top 0.8 m above the floor at 2.0 m/s and must drop into a cup whose rim is 0.1 m above the floor. How far horizontally from the table edge must the cup be (where the ball reaches rim height)? Use g = 9.81 m/s^2 and ignore air. Answer with JSON only: {"x_m": number}';
const PHYS_ANS = 2.0 * Math.sqrt(2 * 0.7 / 9.81); // 0.7555 m
const SHORT_EDIT = 'Scene: {"items":[{"id":"ramp1","type":"ramp","x":0.10,"y":0},{"id":"ball1","type":"ball","x":0.30,"y":0.05},{"id":"cup1","type":"cup","x":0.90,"y":0,"props":{"width":0.10}}]}\n' +
  'Instruction: move the ball 10 cm to the right and make the cup 20% wider.\n' +
  'Return JSON only: {"patches":[{"op":"move","id":string,"x":number} | {"op":"set_props","id":string,"props":object}]}';
const BIG_TASK = 'The image is a scene built in this sandbox (side view of a table top). List the distinct kinds of objects you see (at most 8 kinds), each mapped to the closest catalog type key from the catalog above, with a count. Also report how many dominoes stand on the table. Return JSON only: {"objects":[{"label":string,"type":string,"count":integer}],"dominoes":integer}';
const BIG_SYSTEM = () => 'You are the planning model of a physics sandbox. You only use catalog types listed below.\n\n' + DIGEST;

function checkShort(rec) {
  const p = parseJsonLoose(rec.content);
  const patches = p.value?.patches;
  const mv = Array.isArray(patches) && patches.find(x => x.op === 'move' && x.id === 'ball1');
  const sp = Array.isArray(patches) && patches.find(x => x.op === 'set_props' && x.id === 'cup1');
  return {
    json: p.value !== undefined, raw_json: p.raw,
    pass: !!(mv && Math.abs(mv.x - 0.4) < 0.005 && sp && Math.abs((sp.props?.width ?? 0) - 0.12) < 0.005),
  };
}
function checkBig(rec) {
  const p = parseJsonLoose(rec.content);
  const v = p.value;
  const types = Array.isArray(v?.objects) ? v.objects.map(o => o.type) : [];
  const known = types.filter(t => CATALOG_KEYS.has(t)).length;
  return {
    json: v !== undefined, raw_json: p.raw, dominoes: v?.dominoes ?? null, dominoes_ok: v?.dominoes === 7,
    types: types.slice(0, 10), types_in_catalog: types.length ? +(known / types.length).toFixed(2) : null,
    pass: v !== undefined && types.length > 0,
  };
}

// ---------------------------------------------------------------- the full test matrix
// kind: 'core' = a failure means the route is broken/unreliable; 'feature' = a 4xx means "not supported".
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'];
const REASONING_VARIANTS = [
  ...EFFORTS.map(e => ({ name: `effort_${e}`, params: { reasoning_effort: e } })),
  { name: 'thinking_adaptive', params: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } } },
  { name: 'thinking_budget', params: { thinking: { type: 'enabled', budget_tokens: 2048 } } },
  { name: 'thinking_disabled', params: { thinking: { type: 'disabled' } } },
  // Claude Sonnet 5.5 answers a "disabled" request with: send {"type": "between_tools"} to turn thinking off
  { name: 'thinking_between_tools', params: { thinking: { type: 'between_tools' } } },
];

function tok(ctx, n) { return ctx.tokParam ? { [ctx.tokParam]: n } : {}; }

function fullTests(ctx) {
  const T = [];
  const u = (text, n) => ({ role: 'user', content: text + tag(n) });
  T.push({
    name: 'basic', kind: 'core', timeoutMs: 90000,
    body: n => ({ messages: [u('Reply with the single word: pong', n)] }),
    check: r => ({ pass: /pong/i.test(r.content || '') }),
  });
  // output-cap tests decide which token parameter the rest of the matrix uses
  for (const param of ['max_tokens', 'max_completion_tokens']) {
    T.push({
      name: `${param}_40`, kind: 'feature', group: 'tokens',
      body: n => ({ messages: [u('Write a detailed 600-word essay about how friction slows a sliding wooden block.', n)], [param]: 40 }),
      check: r => {
        const ct = r.usage?.completion_tokens;
        const honoured = ct != null ? ct <= 44 : (r.content || '').split(/\s+/).length <= 45;
        return { completion_tokens: ct ?? null, finish_reason: r.finish_reason, honoured, pass: honoured && /length|max_tokens/i.test(r.finish_reason || '') };
      },
    });
  }
  T.push({ name: 'pick_token_param', kind: 'internal' });
  for (const n of [32000, 64000, 128000]) {
    T.push({
      name: `max_out_${n / 1000}k`, kind: 'feature', group: 'tokens',
      body: k => ({ messages: [u('Reply with the single word: ok', k)], ...tok(ctx, n) }),
      check: r => ({ pass: r.ok }),
    });
  }
  T.push({
    name: 'temperature_0', kind: 'feature',
    body: n => ({ messages: [u('Reply with the single word: ok', n)], temperature: 0, ...tok(ctx, 200) }),
    check: r => ({ pass: /ok/i.test(r.content || '') }),
  });
  T.push({
    name: 'json_object', kind: 'feature', group: 'json',
    body: n => ({
      messages: [{ role: 'system', content: 'You output JSON only.' }, u('Return a JSON object with exactly two keys: "ball" whose value is the string "red", and "count" whose value is the integer 3.', n)],
      response_format: { type: 'json_object' }, ...tok(ctx, 4000),
    }),
    check: r => {
      const p = parseJsonLoose(r.content);
      return { raw_json: p.raw, pass: p.value?.ball === 'red' && p.value?.count === 3 };
    },
  });
  T.push({
    name: 'json_schema_strict', kind: 'feature', group: 'json',
    body: n => ({
      messages: [u('Plan a tiny scene for a physics sandbox: a fixed ramp at x = 0.2 m, a ball at x = 0.25 m that is not fixed, and a fixed cup at x = 0.9 m. Title it "Ramp shot".', n)],
      response_format: { type: 'json_schema', json_schema: { name: 'tiny_plan', strict: true, schema: TINY_SCHEMA } }, ...tok(ctx, 4000),
    }),
    check: r => {
      const p = parseJsonLoose(r.content);
      const errs = p.value === undefined ? ['not json'] : validate(TINY_SCHEMA, p.value);
      const items = p.value?.items || [];
      const byType = Object.fromEntries(items.map(i => [i.type, i]));
      const right = items.length === 3 && byType.ramp?.fixed === true && byType.ball?.fixed === false && Math.abs((byType.cup?.x_m ?? 0) - 0.9) < 1e-6;
      return { raw_json: p.raw, schema_errors: errs.slice(0, 5), schema_valid: errs.length === 0, pass: p.raw && errs.length === 0 && right };
    },
  });
  T.push({
    name: 'tools_forced', kind: 'feature', group: 'tools',
    body: n => ({ messages: [u('Place a ball at x = 0.4 m. It is not fixed.', n)], tools: [PLACE_TOOL], tool_choice: { type: 'function', function: { name: 'place_item' } }, ...tok(ctx, 4000) }),
    check: r => {
      const tc = r.tool_calls?.[0];
      const a = parseJsonLoose(tc?.arguments).value;
      return { tool: tc?.name ?? null, pass: tc?.name === 'place_item' && a?.type === 'ball' && Math.abs((a?.x_m ?? 0) - 0.4) < 1e-6 && a?.fixed === false };
    },
  });
  T.push({
    name: 'tools_auto', kind: 'feature', group: 'tools',
    body: n => ({ messages: [u('Remove the item with id "cup1" from the scene.', n)], tools: [PLACE_TOOL, REMOVE_TOOL], tool_choice: 'auto', ...tok(ctx, 4000) }),
    check: r => {
      const tc = r.tool_calls?.[0];
      const a = parseJsonLoose(tc?.arguments).value;
      return { tool: tc?.name ?? null, pass: tc?.name === 'remove_item' && a?.id === 'cup1' };
    },
  });
  // GPT-6.x rejects json_schema / tools at its default effort ("Function tools with reasoning_effort are not
  // supported ... set reasoning_effort to 'none'"); the same requests with an explicit effort show what works
  for (const effort of ['none', 'low']) {
    for (const base of ['json_schema_strict', 'tools_forced', 'tools_auto']) {
      const b = T.find(x => x.name === base);
      T.push({ name: `${base}_effort_${effort}`, kind: 'feature', group: b.group, body: n => ({ ...b.body(n), reasoning_effort: effort }), check: b.check });
    }
  }
  T.push({
    name: 'image_1536', kind: 'feature', group: 'vision',
    body: n => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'How many red circles and how many blue squares are in this image? Answer with JSON only: {"red_circles": integer, "blue_squares": integer}' + tag(n) }, img(IMAGES.a)] }], ...tok(ctx, 4000) }),
    check: r => { const v = parseJsonLoose(r.content).value; return { answer: v ?? null, pass: v?.red_circles === 3 && v?.blue_squares === 2 }; },
    timeoutMs: 150000,
  });
  T.push({
    name: 'images_2', kind: 'feature', group: 'vision',
    body: n => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'You get two images. In the FIRST image count the red circles; in the SECOND image count the green triangles. Answer with JSON only: {"first_red_circles": integer, "second_green_triangles": integer}' + tag(n) }, img(IMAGES.a), img(IMAGES.b)] }], ...tok(ctx, 4000) }),
    check: r => { const v = parseJsonLoose(r.content).value; return { answer: v ?? null, pass: v?.first_red_circles === 3 && v?.second_green_triangles === 4 }; },
    timeoutMs: 150000,
  });
  T.push({
    name: 'images_4', kind: 'feature', group: 'vision',
    body: n => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'You get four images, in order. For each image count the filled shapes (circles, squares, triangles, rectangles). Answer with JSON only: {"counts": [integer, integer, integer, integer]}' + tag(n) }, img(IMAGES.a), img(IMAGES.b), img(IMAGES.c), img(IMAGES.d)] }], ...tok(ctx, 4000) }),
    check: r => { const v = parseJsonLoose(r.content).value; return { answer: v ?? null, pass: JSON.stringify(v?.counts) === '[5,4,6,2]' }; },
    timeoutMs: 180000,
  });
  T.push({
    name: 'images_4_heavy', kind: 'feature', group: 'vision',
    body: n => ({ messages: [{ role: 'user', content: [{ type: 'text', text: 'How many images did you receive? Answer with JSON only: {"images": integer}' + tag(n) }, img(IMAGES.heavy), img(IMAGES.heavy), img(IMAGES.heavy), img(IMAGES.heavy)] }], ...tok(ctx, 4000) }),
    check: r => { const v = parseJsonLoose(r.content).value; return { answer: v ?? null, pass: v?.images === 4 }; },
    timeoutMs: 240000,
  });
  for (const v of REASONING_VARIANTS) {
    T.push({
      name: 'reasoning_' + v.name, kind: 'feature', group: 'reasoning',
      body: n => ({ messages: [u(PHYS_Q, n)], ...v.params, ...tok(ctx, 16000) }),
      check: r => {
        const x = parseJsonLoose(r.content).value?.x_m;
        return {
          correct: typeof x === 'number' && Math.abs(x - PHYS_ANS) < 0.012,
          reasoning_tokens: r.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          completion_tokens: r.usage?.completion_tokens ?? null,
          reasoning_chars: r.reasoning_chars ?? 0,
          pass: r.ok,
        };
      },
      timeoutMs: 240000,
    });
  }
  T.push({ name: 'latency', kind: 'internal' });
  return T;
}

function summarizeTrials(trials) {
  const ok = trials.filter(t => t.ok);
  const s = k => median(ok.map(t => t[k]));
  return {
    n: trials.length, ok: ok.length,
    p50_total: s('ms_total'), p50_ttfb: s('ms_ttfb'), p50_first_token: s('ms_first_token'), p50_first_content: s('ms_first_content'),
    min_total: ok.length ? Math.min(...ok.map(t => t.ms_total)) : null,
    max_total: ok.length ? Math.max(...ok.map(t => t.ms_total)) : null,
    p50_model_call: s('ms_model_call'),
    p50_overhead: s('ms_overhead'), p50_adj_total: s('ms_adj_total'), p50_adj_first_content: s('ms_adj_first_content'), p50_adj_first_token: s('ms_adj_first_token'),
    pass: ok.filter(t => t.check?.pass).length,
    trials,
  };
}

function compact(rec, check) {
  const keep = {};
  if (rec.ms_overhead != null) {
    if (rec.ms_total != null) rec.ms_adj_total = rec.ms_total - rec.ms_overhead;
    if (rec.ms_first_content != null) rec.ms_adj_first_content = rec.ms_first_content - rec.ms_overhead;
    if (rec.ms_first_token != null) rec.ms_adj_first_token = rec.ms_first_token - rec.ms_overhead;
  }
  for (const k of ['ok', 'status', 'stream', 'ms_ttfb', 'ms_first_token', 'ms_first_content', 'ms_total', 'ms_overhead', 'ms_adj_total', 'ms_adj_first_token', 'ms_adj_first_content',
    'ms_model_call', 'ms_gateway_total', 'ms_provider_processing',
    'resolved_model', 'model_returned', 'provider', 'finish_reason', 'reasoning_chars', 'thinking_blocks', 'gateway_cache', 'stream_returned_json', 'retry_of', 'req_bytes', 'refusal'])
    if (rec[k] !== undefined && rec[k] !== null) keep[k] = rec[k];
  if (rec.usage) {
    const u = rec.usage;
    keep.usage = { prompt: u.prompt_tokens, completion: u.completion_tokens };
    const cached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens;
    if (cached) keep.usage.cached = cached;
    const rt = u.completion_tokens_details?.reasoning_tokens;
    if (rt) keep.usage.reasoning = rt;
    if (u.costInUSD != null) keep.usage.usd = u.costInUSD;
  }
  if (rec.error) keep.error = rec.error;
  if (rec.content) keep.content_head = scrub(rec.content).slice(0, 240);
  if (rec.tool_calls?.length) keep.tool_calls = rec.tool_calls.map(t => ({ name: t.name, arguments: scrub(t.arguments || '').slice(0, 200) }));
  if (check) keep.check = check;
  return keep;
}

// ---------------------------------------------------------------- full phase
async function probeModel(model, db) {
  const ctx = { model, tokParam: null };
  // with --tests, merge into the existing entry: re-run tests replace their old results, the rest stay
  const prevEntry = OPT.tests ? db.full[model] : null;
  const entry = prevEntry
    ? { ...prevEntry, tests: { ...prevEntry.tests }, latency: { ...prevEntry.latency }, attempts: [...(prevEntry.attempts || [])], started_rerun: new Date().toISOString() }
    : { model, family: canonical(model), route: routeOf(model), started: new Date().toISOString(), transport: OPT.transport, tests: {}, latency: {}, attempts: [] };
  if (prevEntry) delete entry.unavailable;
  const reuse = !!(prevEntry && prevEntry.token_param !== undefined);
  const record = (name, attempts, check) => {
    const rec = attempts[attempts.length - 1];
    entry.tests[name] = compact(rec, check);
    if (attempts.length > 1) entry.tests[name].first_attempt_error = attempts[0].error;
    entry.attempts = entry.attempts.filter(a => a.test !== name);
    for (const a of attempts) entry.attempts.push({ test: name, ok: a.ok, status: a.status ?? null, kind: a.error?.kind ?? null, ms: a.ms_total, overhead: a.ms_overhead ?? null, stream: a.stream });
    if (rec.ratelimit) entry.ratelimit_headers = rec.ratelimit;
    if (rec.resolved_model) { entry.resolved_models ||= []; if (!entry.resolved_models.includes(rec.resolved_model)) entry.resolved_models.push(rec.resolved_model); }
    if (rec.routing_order) entry.routing_order = rec.routing_order;
    if (rec.context_length) entry.context_length = rec.context_length;
    if (rec.provider) entry.provider = rec.provider;
    if (rec.model_returned) entry.model_returned = rec.model_returned;
    log(model, name, rec, check);
  };
  const only = OPT.tests ? new Set(OPT.tests) : null;
  const tests = fullTests(ctx);
  for (const t of tests) {
    if (t.name === 'pick_token_param') {
      if (reuse && !(only?.has('max_tokens_40') || only?.has('max_completion_tokens_40'))) { ctx.tokParam = entry.token_param; continue; }
      const a = entry.tests.max_tokens_40, b = entry.tests.max_completion_tokens_40;
      ctx.tokParam = a?.ok && a.check?.honoured ? 'max_tokens' : b?.ok && b.check?.honoured ? 'max_completion_tokens' : a?.ok ? 'max_tokens' : b?.ok ? 'max_completion_tokens' : null;
      entry.token_param = ctx.tokParam;
      continue;
    }
    if (t.name === 'latency') {
      if (!only || only.has('latency')) await latencyRuns(model, ctx, entry, record);
      continue;
    }
    if (only && !only.has(t.name) && (reuse || (t.group !== 'tokens' && t.name !== 'basic'))) continue;
    if (entry.slow && !SLOW_KEEP.has(t.name)) { entry.tests[t.name] = { skipped: 'slow route: ' + entry.slow }; continue; }
    const { rec, attempts } = await callWithRetry(model, t.body(nonce()), { timeoutMs: t.timeoutMs || 120000 });
    record(t.name, attempts, rec.ok ? t.check(rec) : undefined);
    // slow-route rule: a route that needs > 15 s for "pong" or times out twice is not usable interactively;
    // keep only the tests that decide its role (JSON, tools, vision, effort) and one latency trial
    if (!entry.slow) {
      if (t.name === 'basic' && rec.ok && rec.ms_total > 15000) entry.slow = `"pong" took ${(rec.ms_total / 1000).toFixed(0)} s`;
      if (entry.attempts.filter(a => a.kind === 'timeout').length >= 2) entry.slow = 'two timeouts';
    }
    if (t.name === 'basic' && !rec.ok) {
      // the route cannot answer "pong" (4xx, or still failing after one retry, or no answer in 90 s): skip the rest
      entry.unavailable = (rec.status ? `HTTP ${rec.status}: ` : '') + (rec.error?.message || 'failed');
      break;
    }
  }
  entry.finished = new Date().toISOString();
  entry.counts = countAttempts(entry.attempts, entry.tests);
  delete entry.attempts_raw;
  db.full[model] = entry;
  saveDb(db);
}

function fastestControl(entry) {
  const cands = ['effort_none', 'effort_minimal', 'thinking_disabled', 'thinking_between_tools', 'effort_low']
    .map((n, i) => ({ n, i, r: entry.tests['reasoning_' + n] }))
    .filter(c => c.r?.ok && c.r.check);
  if (!cands.length) return null;
  const reasoning = r => r.usage?.reasoning ?? (r.reasoning_chars ? r.reasoning_chars / 4 : 0);
  cands.sort((a, b) => reasoning(a.r) - reasoning(b.r) || (a.r.usage?.completion ?? 0) - (b.r.usage?.completion ?? 0) || a.i - b.i);
  return cands[0].n;
}

function shortBodyFor(ctx) {
  return () => ({ messages: [{ role: 'system', content: 'You edit physics-sandbox scenes. Reply with JSON only.' }, { role: 'user', content: SHORT_EDIT + tag(nonce()) }], ...tok(ctx, 2000) });
}
function bigBodyFor(ctx) {
  return () => ({
    messages: [{ role: 'system', content: BIG_SYSTEM() }, { role: 'user', content: [{ type: 'text', text: BIG_TASK + tag(nonce()) }, img(IMAGES.scene)] }],
    ...tok(ctx, 16000),
  });
}

const SLOW_KEEP = new Set(['basic', 'max_tokens_40', 'max_completion_tokens_40', 'json_object', 'json_schema_strict', 'tools_auto', 'image_1536', 'images_4',
  'reasoning_effort_none', 'reasoning_effort_low', 'reasoning_effort_high']);

async function latencyRuns(model, ctx, entry, record) {
  const shortBody = shortBodyFor(ctx), bigBody = bigBodyFor(ctx);
  const trials = entry.slow ? 1 : OPT.trials;
  entry.attempts = entry.attempts.filter(a => !a.test.startsWith('latency_'));
  entry.latency = {};
  entry.latency_transport = OPT.transport;
  const runs = entry.slow ? { short_ns: [], big_ns: [] } : { short_ns: [], short_s: [], big_ns: [], big_s: [] };
  for (let i = 0; i < trials; i++) {
    for (const [key, mk, stream, chk, to] of [
      ['short_ns', shortBody, false, checkShort, 90000], ['short_s', shortBody, true, checkShort, 90000],
      ['big_ns', bigBody, false, checkBig, 240000], ['big_s', bigBody, true, checkBig, 240000],
    ].filter(x => runs[x[0]])) {
      const rec = await call(model, mk(), { stream, timeoutMs: to });
      const check = rec.ok ? chk(rec) : undefined;
      runs[key].push(compact(rec, check));
      entry.attempts.push({ test: 'latency_' + key, ok: rec.ok, status: rec.status ?? null, kind: rec.error?.kind ?? null, ms: rec.ms_total, stream });
      if (rec.ratelimit) entry.ratelimit_headers = rec.ratelimit;
      log(model, `latency_${key}#${i + 1}`, rec, check);
      if (rec.error?.kind === 'rate_limit') await sleep(Math.min(30000, (parseFloat(rec.retry_after) || 10) * 1000));
    }
  }
  const fast = fastestControl(entry);
  if (fast) {
    const params = REASONING_VARIANTS.find(v => v.name === fast).params;
    runs.short_fast_ns = []; runs.big_fast_ns = [];
    for (let i = 0; i < trials; i++) {
      for (const [key, mk, chk, to] of [['short_fast_ns', shortBody, checkShort, 90000], ['big_fast_ns', bigBody, checkBig, 240000]]) {
        const rec = await call(model, { ...mk(), ...params }, { timeoutMs: to });
        const check = rec.ok ? chk(rec) : undefined;
        runs[key].push(compact(rec, check));
        entry.attempts.push({ test: 'latency_' + key, ok: rec.ok, status: rec.status ?? null, kind: rec.error?.kind ?? null, ms: rec.ms_total, stream: false });
        log(model, `latency_${key}(${fast})#${i + 1}`, rec, check);
      }
    }
    entry.fast_control = fast;
  }
  for (const [k, v] of Object.entries(runs)) entry.latency[k] = summarizeTrials(v);
  const pt = runs.big_ns.find(r => r.usage?.prompt)?.usage?.prompt;
  if (pt) entry.big_prompt_tokens = pt;
}

const CORE_TESTS = new Set(['basic']);
function countAttempts(attempts, tests) {
  const c = { calls: attempts.length, ok: 0, unsupported_4xx: 0, rate_limited: 0, server_5xx: 0, timeouts: 0, network: 0, stream_errors: 0, other: 0, core_calls: 0, core_failed: 0 };
  for (const a of attempts) {
    const core = CORE_TESTS.has(a.test) || a.test.startsWith('latency_');
    if (core) c.core_calls++;
    if (a.ok) { c.ok++; continue; }
    if (core) c.core_failed++;
    switch (a.kind) {
      case 'client': c.unsupported_4xx++; break;
      case 'rate_limit': c.rate_limited++; break;
      case 'server': c.server_5xx++; break;
      case 'timeout': case 'timeout_upstream': c.timeouts++; break;
      case 'network': c.network++; break;
      case 'stream': c.stream_errors++; break;
      default: c.other++;
    }
  }
  c.transport_errors = c.rate_limited + c.server_5xx + c.timeouts + c.network + c.stream_errors + c.other;
  c.error_rate = c.calls ? +(c.transport_errors / c.calls).toFixed(3) : null;
  return c;
}

// ---------------------------------------------------------------- sweep phase
async function sweepModel(model, db) {
  const e = { model, family: canonical(model), route: routeOf(model), at: new Date().toISOString(), transport: OPT.transport, tests: {} };
  const run = async (name, body, stream, chk, timeoutMs = 120000) => {
    const rec = await call(model, body, { stream, timeoutMs });
    const check = rec.ok ? chk(rec) : undefined;
    e.tests[name] = compact(rec, check);
    if (rec.ratelimit) e.ratelimit_headers = rec.ratelimit;
    if (rec.resolved_model) e.resolved_model = rec.resolved_model;
    if (rec.routing_order) e.routing_order = rec.routing_order;
    if (rec.context_length) e.context_length = rec.context_length;
    log(model, 'sweep_' + name, rec, check);
    return rec;
  };
  const b = await run('basic', { messages: [{ role: 'user', content: 'Reply with the single word: pong' + tag(nonce()) }] }, false, r => ({ pass: /pong/i.test(r.content || '') }), 90000);
  if (b.ok) {
    await run('stream_json', { messages: [{ role: 'user', content: 'Return JSON only: {"ok": true, "n": 7}' + tag(nonce()) }] }, true,
      r => { const v = parseJsonLoose(r.content).value; return { pass: v?.ok === true && v?.n === 7 }; });
    await run('image_512', { messages: [{ role: 'user', content: [{ type: 'text', text: 'How many red circles are in this image? Answer with JSON only: {"red_circles": integer}' + tag(nonce()) }, img(IMAGES.a512)] }] }, false,
      r => { const v = parseJsonLoose(r.content).value; return { pass: v?.red_circles === 3 }; });
  } else {
    e.unavailable = (b.status ? `HTTP ${b.status}: ` : '') + (b.error?.message || 'failed');
  }
  db.sweep[model] = e;
  saveDb(db);
}

// ---------------------------------------------------------------- persistence + logging
function loadDb() {
  if (!OPT.fresh && fs.existsSync(OPT.out)) {
    try { return JSON.parse(fs.readFileSync(OPT.out, 'utf8')); } catch { /* start over */ }
  }
  return { schema: 'gateway-probe/1', created: new Date().toISOString(), full: {}, sweep: {} };
}
function saveDb(db) {
  db.updated = new Date().toISOString();
  db.base_url = BASE;
  db.method = {
    ...(db.method || {}),
    concurrency_cap: OPT.concurrency, trials: OPT.trials,
    transport: 'node:https (HTTP/1.1, keep-alive socket per request) unless an entry says transport "fetch" (see transport_note)',
    note: 'Every request carries a random tag at the end of the last user message, so the gateway cannot serve a cached answer; the long system prompt stays identical, so provider prefix caching may apply on later trials (see usage.cached).',
    big_prompt: 'system = catalog digest (~6k tokens) + one 1536x864 JPEG render; output = short JSON',
    short_prompt: 'tiny scene JSON + edit instruction; output = 2 patches (~40 tokens)',
    images: Object.fromEntries(fs.readdirSync(ASSETS).filter(f => f.endsWith('.jpg')).map(f => [f, fs.statSync(path.join(ASSETS, f)).size])),
    digest_chars: DIGEST?.length ?? db.method?.digest_chars ?? null,
  };
  const tmp = OPT.out + '.tmp';
  const text = scrub(JSON.stringify(db, null, 1));
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, OPT.out);
}
const T0 = Date.now();
function log(model, test, rec, check) {
  const s = rec.ok ? (check?.pass === false ? 'ok/FAILCHECK' : 'ok') : `ERR ${rec.status ?? ''} ${rec.error?.kind}: ${(rec.error?.message || '').slice(0, 110)}`;
  const t = rec.stream ? ` ttft ${rec.ms_first_content ?? rec.ms_first_token ?? '-'}` : '';
  console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${model} ${test}: ${s} ${rec.ms_total ?? '-'}ms${t}`);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { console.error('probe error', it, scrub(e?.stack || e)); } }
  }));
}

// ---------------------------------------------------------------- throttle phase
// Tiny calls at 1 and 4 in flight over both transports: shows where the extra wait comes from.
const THROTTLE_MODEL = 'openai-group/gpt-5.4-mini';
async function throttlePhase(db) {
  const model = OPT.models?.[0] || THROTTLE_MODEL;
  const out = { model, at: new Date().toISOString(), runs: [] };
  for (const [transport, conc, n] of [['fetch', 1, 6], ['https', 1, 6], ['fetch', 4, 12], ['https', 4, 12], ['fetch', 4, 12], ['https', 4, 12]]) {
    const t0 = performance.now();
    const calls = [];
    let k = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (k < n) {
        const i = k++;
        const start = performance.now() - t0;
        const rec = await call(model, { messages: [{ role: 'user', content: 'Reply with the single word: pong' + tag(nonce()) }] }, { timeoutMs: 60000, transport });
        calls.push({ i, start: round(start), ok: rec.ok, status: rec.status ?? null, ms_total: rec.ms_total, ms_gateway_total: rec.ms_gateway_total ?? null, ms_overhead: rec.ms_overhead ?? null, error: rec.error?.message });
        log(model, `throttle_${transport}_c${conc}#${i + 1}`, rec);
      }
    }));
    const wall = performance.now() - t0;
    calls.sort((a, b) => a.i - b.i);
    const ov = calls.map(c => c.ms_overhead).filter(x => x != null);
    out.runs.push({
      transport, protocol: transport === 'fetch' ? 'HTTP/2, one connection (Node fetch / undici)' : 'HTTP/1.1, keep-alive socket per request (node:https)',
      concurrency: conc, n, wall_ms: round(wall), rps: +(n / (wall / 1000)).toFixed(2),
      p50_total: median(calls.map(c => c.ms_total)), p50_gateway: median(calls.map(c => c.ms_gateway_total)),
      p50_overhead: median(ov), max_overhead: ov.length ? Math.max(...ov) : null, errors: calls.filter(c => !c.ok).length, calls,
    });
    await sleep(3000);
  }
  db.throttle = out;
  saveDb(db);
}

// ---------------------------------------------------------------- clean phase
// Strictly one request in flight: wall-clock latency without the probe's own queueing.
const CLEAN_MODELS = [
  'claude-group/claude-opus-5-5', 'claude-group/claude-sonnet-5-5', 'claude-group/claude-haiku-5-5', 'claude-group/claude-fable-5-1',
  'gemini-group/gemini-4-argon', 'gemini-group/gemini-3.8-flash', 'openai-group/gpt-6.1-sol', 'openai-group/gpt-5.4-mini',
  'xai-group/grok-4.7', 'bedrock-oss-group/qwen3-vl-235b',
];
async function cleanModel(model, db) {
  const f = db.full?.[model];
  const ctx = { model, tokParam: f?.token_param ?? 'max_tokens' };
  const fast = f?.fast_control || null;
  const params = fast ? REASONING_VARIANTS.find(v => v.name === fast).params : null;
  const shortBody = shortBodyFor(ctx), bigBody = bigBodyFor(ctx);
  const plan = [['short_ns', shortBody, checkShort, null, 90000], ['big_ns', bigBody, checkBig, null, 240000]];
  if (params) plan.push(['short_fast_ns', shortBody, checkShort, params, 90000], ['big_fast_ns', bigBody, checkBig, params, 240000]);
  const runs = {};
  for (let i = 0; i < OPT.trials; i++) {
    for (const [key, mk, chk, extra, to] of plan) {
      const rec = await call(model, { ...mk(), ...(extra || {}) }, { timeoutMs: to });
      const check = rec.ok ? chk(rec) : undefined;
      (runs[key] ||= []).push(compact(rec, check));
      log(model, `clean_${key}#${i + 1}`, rec, check);
    }
  }
  db.clean ||= {};
  db.clean[model] = { model, at: new Date().toISOString(), transport: OPT.transport, fast_control: fast, latency: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, summarizeTrials(v)])) };
  saveDb(db);
}

// ---------------------------------------------------------------- report
function fmtMs(x) { return x == null ? '–' : x >= 10000 ? (x / 1000).toFixed(1) + ' s' : (x / 1000).toFixed(2) + ' s'; }
function yn(t, f) {
  if (!t) return '–';
  if (t.skipped) return 'skip';
  if (!t.ok) return t.status >= 400 && t.status < 500 && t.status !== 429 ? 'no' : 'err';
  const pass = f ? f(t) : t.check?.pass;
  return pass ? 'yes' : 'partial';
}
const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
// which backend served the calls of a gateway route (x-tfy-applied-rules), e.g. "anthropic-primary ×39, aws-bedrock/global ×3"
function resolvedMix(e) {
  const c = {};
  const add = r => { if (r?.resolved_model) c[r.resolved_model] = (c[r.resolved_model] || 0) + 1; };
  Object.values(e.tests || {}).forEach(add);
  Object.values(e.latency || {}).forEach(l => l.trials.forEach(add));
  const short = id => { const [p, rest] = id.split('/'); const reg = rest?.match(/^(global|us|eu)\./)?.[1]; return reg ? `${p}/${reg}` : p; };
  const parts = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${short(m)} ×${n}`);
  return parts.length ? parts.join(', ') : `direct (${e.provider || '?'})`;
}
// adjusted (gateway-measured) / wall
function aw(adj, wall) { return adj == null && wall == null ? '–' : `${fmtMs(adj)} <sub>(${fmtMs(wall)})</sub>`; }

function writeReport(db) {
  const full = Object.values(db.full || {});
  const sweep = Object.values(db.sweep || {});
  const order = id => { const i = FULL_MODELS.indexOf(id); return i < 0 ? 999 : i; };
  full.sort((a, b) => order(a.model) - order(b.model));
  const L = [];
  const prev = fs.existsSync(MD_OUT) ? fs.readFileSync(MD_OUT, 'utf8') : '';
  const notes = prev.match(/<!-- notes:start -->[\s\S]*?<!-- notes:end -->/)?.[0] ||
    '<!-- notes:start -->\n## Findings and recommendations\n\n(written by hand after the run; kept when the tables are regenerated)\n<!-- notes:end -->';
  L.push('# Gateway probe: TrueFoundry chat routes', '');
  L.push(`Measured ${db.updated?.slice(0, 16).replace('T', ' ')} UTC against \`${db.base_url}\` by \`ai/research/probe.mjs\` (machine-readable: \`gateway-probe.json\`, whose top-level \`summary\` has one row per deep-probed route). At most ${db.method?.concurrency_cap ?? 4} requests in flight. Medians of ${db.method?.trials ?? 3} trials.`, '');
  L.push('**How to read latency cells:** `adjusted (wall)`. *Wall* is what this Mac saw. *Adjusted* subtracts the time spent outside the gateway\'s own processing (wall at response headers minus the gateway\'s `server-timing` total: queueing on the connection, network, TLS). Adjusted is the fair number for comparing models; section 7 has wall-clock numbers with one request in flight. All latency runs use HTTP/1.1 (section 6 explains why).', '');
  L.push(notes, '');

  L.push('## 1. Capability matrix (deep probe)', '');
  L.push('yes = accepted and the answer checked out · partial = accepted but the answer was wrong or unparseable · no = rejected (4xx) · err = 5xx/timeout · skip = slow route (over 15 s for "pong" or two timeouts), only the decisive tests and one latency trial were run · – = not run.', '');
  L.push('| Model route | Resolves to (calls) | Works | json_object | json_schema strict | tools forced / auto | same 3, effort none | same 3, effort low | 1 image 1536 | 2 images | 4 images | 4 heavy (~6.6 MB body) | temp 0 | token param | 40-token cap honoured | 32k / 64k / 128k out |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of full) {
    const t = e.tests;
    if (e.unavailable) { L.push(`| \`${e.model}\` | – | **no**: ${cell(e.unavailable.slice(0, 90))} | | | | | | | | | | | | | |`); continue; }
    const cap = (t.max_tokens_40?.check?.honoured || t.max_completion_tokens_40?.check?.honoured) ? 'yes' : (t.max_tokens_40?.ok || t.max_completion_tokens_40?.ok) ? 'no' : '–';
    const outs = ['32k', '64k', '128k'].map(k => (t['max_out_' + k] ? (t['max_out_' + k].skipped ? 'skip' : t['max_out_' + k].ok ? 'ok' : 'no') : '–')).join(' / ');
    L.push(`| \`${e.model}\` | ${resolvedMix(e)} | ${t.basic?.ok ? (t.basic.check?.pass ? 'yes' : 'yes (refused "pong")') : yn(t.basic)} | ${yn(t.json_object)} | ${yn(t.json_schema_strict)} | ${yn(t.tools_forced)} / ${yn(t.tools_auto)} | ${yn(t.json_schema_strict_effort_none)} / ${yn(t.tools_forced_effort_none)} / ${yn(t.tools_auto_effort_none)} | ${yn(t.json_schema_strict_effort_low)} / ${yn(t.tools_forced_effort_low)} / ${yn(t.tools_auto_effort_low)} | ${yn(t.image_1536)} | ${yn(t.images_2)} | ${yn(t.images_4)} | ${yn(t.images_4_heavy)} | ${yn(t.temperature_0)} | ${e.token_param || '–'} | ${cap} | ${outs} |`);
  }
  L.push('');
  // rejected-parameter messages, deduplicated: why something says "no"
  const why = new Map();
  for (const e of full) for (const [n, t] of Object.entries(e.tests || {})) {
    if (t.ok || !t.error || t.error.kind !== 'client') continue;
    const key = n + ' :: ' + t.error.message.replace(/req_[A-Za-z0-9]+/g, '').slice(0, 160);
    if (!why.has(key)) why.set(key, []);
    why.get(key).push(e.model);
  }
  if (why.size) {
    L.push('<details><summary>Why routes said "no" (gateway/provider messages)</summary>', '');
    for (const [k, ms] of why) L.push(`- **${cell(k.split(' :: ')[0])}**: ${cell(k.split(' :: ')[1])} — ${ms.map(m => '`' + m + '`').join(', ')}`);
    L.push('', '</details>', '');
  }

  L.push('## 2. Reasoning controls', '');
  L.push('Each cell: adjusted time · reasoning tokens (`tok`, from usage) or visible reasoning text (`ch`) · answer right? The task is a two-step projectile question (answer 0.756 m). "no" = the route rejected the parameter. Claude routes do not report reasoning tokens separately; their summarised thinking shows up as `ch`.', '');
  L.push('| Model route | ' + REASONING_VARIANTS.map(v => v.name.replace('_', ' ')).join(' | ') + ' |');
  L.push('|---|' + REASONING_VARIANTS.map(() => '---').join('|') + '|');
  for (const e of full) {
    if (e.unavailable) continue;
    const cells = REASONING_VARIANTS.map(v => {
      const r = e.tests['reasoning_' + v.name];
      if (!r) return '–';
      if (r.skipped) return 'skip';
      if (!r.ok) return r.status >= 400 && r.status < 500 && r.status !== 429 ? 'no' : 'err';
      const rt = r.usage?.reasoning ? `${r.usage.reasoning} tok` : r.reasoning_chars ? `${r.reasoning_chars} ch` : '0';
      return `${fmtMs(r.ms_adj_total ?? r.ms_total)} · ${rt} · ${r.check?.correct ? '✓' : '✗'}`;
    });
    L.push(`| \`${e.model}\` | ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 3. Latency (deep probe, adjusted (wall))', '');
  L.push('Short = tiny edit task (~150–230 tokens in, ~40–200 out). Big = catalog digest (~6k tokens on GPT, ~7k Gemini, ~8k Claude) + one 1536×864 JPEG render of the app, short JSON out. *ns* = non-streaming total; *s* = streaming, time to first answer token. *fast* = the same task with the lowest reasoning setting the route accepts (named in brackets). ✓ columns: short = both patches right; dominoes = the render has 7, counted right.', '');
  L.push('| Model route | short ns | short s TTFT | short fast ns | big ns | big s TTFT | big fast ns | prompt tok (big) | short ✓ | dominoes ✓ | overhead p50 | errors / calls |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of full) {
    if (e.unavailable) continue;
    const l = e.latency || {};
    const sn = l.short_ns, ss = l.short_s, bn = l.big_ns, bs = l.big_s, sf = l.short_fast_ns, bf = l.big_fast_ns;
    const shortTrials = [sn, ss, sf].filter(Boolean).flatMap(x => x.trials);
    const dom = [bn, bs, bf].filter(Boolean).flatMap(x => x.trials).filter(t => t.check).map(t => t.check.dominoes_ok);
    const ovs = Object.values(l).flatMap(x => x.trials).map(t => t.ms_overhead);
    const c = e.counts || {};
    L.push(`| \`${e.model}\` | ${aw(sn?.p50_adj_total, sn?.p50_total)} | ${aw(ss?.p50_adj_first_content ?? ss?.p50_adj_first_token, ss?.p50_first_content ?? ss?.p50_first_token)} | ${sf ? aw(sf.p50_adj_total, sf.p50_total) + ' ' + e.fast_control.replace('effort_', '').replace('thinking_', '') : '–'} | ${aw(bn?.p50_adj_total, bn?.p50_total)} | ${aw(bs?.p50_adj_first_content ?? bs?.p50_adj_first_token, bs?.p50_first_content ?? bs?.p50_first_token)} | ${bf ? aw(bf.p50_adj_total, bf.p50_total) : '–'} | ${e.big_prompt_tokens ?? '–'} | ${shortTrials.filter(t => t.check?.pass).length}/${shortTrials.length} | ${dom.filter(Boolean).length}/${dom.length} | ${fmtMs(median(ovs))} | ${c.transport_errors ?? 0}/${c.calls ?? 0} |`);
  }
  L.push('');

  const fam = {};
  for (const e of full) if (!e.unavailable) (fam[e.family] ||= []).push(e);
  L.push('## 4. Route comparison per model (deep probe)', '');
  L.push('Within each model the most reliable route comes first (fewest transport errors: 5xx, 429, timeouts, network, stream errors), then the fastest (adjusted median short ns + big ns). The fallback chain is what the gateway reported in `x-tfy-applied-rules`.', '');
  L.push('| Model | Route | Fallback chain | short ns | big ns | big s TTFT | transport errors | pick |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const [f, list] of Object.entries(fam)) {
    const score = e => ({ err: e.counts?.transport_errors ?? 99, ms: (e.latency?.short_ns?.p50_adj_total ?? 1e6) + (e.latency?.big_ns?.p50_adj_total ?? 1e6) });
    const sorted = [...list].sort((a, b) => score(a).err - score(b).err || score(a).ms - score(b).ms);
    sorted.forEach((e, i) => {
      L.push(`| ${i === 0 ? f : ''} | \`${e.model}\` | ${(e.routing_order || e.resolved_models || []).join(' → ') || '–'} | ${fmtMs(e.latency?.short_ns?.p50_adj_total)} | ${fmtMs(e.latency?.big_ns?.p50_adj_total)} | ${fmtMs(e.latency?.big_s?.p50_adj_first_content ?? e.latency?.big_s?.p50_adj_first_token)} | ${e.counts?.transport_errors ?? 0}/${e.counts?.calls ?? 0} | ${i === 0 && list.length > 1 ? '**best**' : ''} |`);
    });
  }
  L.push('');

  if (sweep.length) {
    L.push('## 5. Route sweep (every chat route in scope, 3 single calls each)', '');
    L.push('basic = "pong", non-streaming; stream = tiny JSON, first token; image = 512 px JPEG, count the red circles (3). One shot each: indicative only. Times are adjusted (wall). Routes from other teams\' dedicated allocations (openai-academics/-esw, vertex-contract-analyzer) were left out on purpose.', '');
    const sfam = {};
    for (const e of sweep) (sfam[e.family] ||= []).push(e);
    L.push('| Model | Route id | Works | Resolves to | basic | stream TTFT | image ✓ | note |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const f of Object.keys(sfam).sort()) {
      const list = sfam[f].sort((a, b) => (a.tests.basic?.ok ? 0 : 1) - (b.tests.basic?.ok ? 0 : 1) || (a.tests.basic?.ms_adj_total ?? 1e9) - (b.tests.basic?.ms_adj_total ?? 1e9));
      list.forEach((e, i) => {
        const b = e.tests.basic, s = e.tests.stream_json, im = e.tests.image_512;
        const note = e.unavailable ? cell(e.unavailable.slice(0, 90)) : cell([s && !s.ok ? 'stream: ' + (s.error?.message || '').slice(0, 60) : '', im && !im.ok ? 'image: ' + (im.error?.message || '').slice(0, 60) : ''].filter(Boolean).join('; '));
        L.push(`| ${i === 0 ? f : ''} | \`${e.model}\` | ${b?.ok ? 'yes' : '**no**'} | ${e.resolved_model || b?.provider || '–'} | ${b?.ok ? aw(b.ms_adj_total, b.ms_total) : '–'} | ${s?.ok ? aw(s.ms_adj_first_content ?? s.ms_adj_first_token, s.ms_first_content ?? s.ms_first_token) : '–'} | ${im ? (im.ok ? (im.check?.pass ? 'yes' : 'wrong') : 'no') : '–'} | ${note} |`);
      });
    }
    L.push('');
  }

  if (db.throttle) {
    const th = db.throttle;
    L.push('## 6. Parallel requests: HTTP/2 (Node fetch) vs HTTP/1.1 (node:https)', '');
    L.push(`Tiny "pong" calls to \`${th.model}\` at ${th.at.slice(0, 16).replace('T', ' ')} UTC. *Overhead* = wall time at response headers minus the gateway's own server-timing total. Node's built-in fetch (undici 8) negotiates HTTP/2 with this gateway and sends every request over one connection, where they are served one after another; plain HTTP/1.1 with a keep-alive agent gives each request its own socket.`, '');
    L.push('| Transport | In flight | calls | wall | throughput | gateway p50 | wall p50 | overhead p50 | overhead max | errors |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of th.runs) L.push(`| ${r.transport === 'fetch' ? 'fetch (HTTP/2)' : 'https (HTTP/1.1)'} | ${r.concurrency} | ${r.n} | ${fmtMs(r.wall_ms)} | ${r.rps}/s | ${fmtMs(r.p50_gateway)} | ${fmtMs(r.p50_total)} | ${fmtMs(r.p50_overhead)} | ${fmtMs(r.max_overhead)} | ${r.errors} |`);
    L.push('');
  }

  if (db.clean && Object.keys(db.clean).length) {
    L.push('## 7. Wall-clock latency with one request in flight (clean pass)', '');
    L.push('Same tasks as section 3, run strictly one at a time (other users of the key could still add delay; overhead is shown). Times are wall (adjusted in brackets).', '');
    L.push('| Model route | short ns | short fast ns | big ns | big fast ns | overhead p50 | short ✓ | dominoes ✓ |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const c of Object.values(db.clean)) {
      const l = c.latency;
      const w = x => (x ? `${fmtMs(x.p50_total)} <sub>(${fmtMs(x.p50_adj_total)})</sub>` : '–');
      const all = Object.values(l).flatMap(x => x.trials);
      const st = [l.short_ns, l.short_fast_ns].filter(Boolean).flatMap(x => x.trials);
      const dom = [l.big_ns, l.big_fast_ns].filter(Boolean).flatMap(x => x.trials).filter(t => t.check).map(t => t.check.dominoes_ok);
      L.push(`| \`${c.model}\` | ${w(l.short_ns)} | ${l.short_fast_ns ? w(l.short_fast_ns) + ' ' + (c.fast_control || '').replace(/^(effort|thinking)_/, '') : '–'} | ${w(l.big_ns)} | ${w(l.big_fast_ns)} | ${fmtMs(median(all.map(t => t.ms_overhead)))} | ${st.filter(t => t.check?.pass).length}/${st.length} | ${dom.filter(Boolean).length}/${dom.length} |`);
    }
    L.push('');
  }

  L.push('## 8. Rate-limit headers seen', '');
  const seen = {};
  for (const e of [...full, ...sweep]) {
    if (!e.ratelimit_headers) continue;
    const prov = (e.resolved_models?.[0] || e.resolved_model || e.model).split('/')[0];
    seen[prov] ||= { model: e.model, h: e.ratelimit_headers };
  }
  if (!Object.keys(seen).length) L.push('None of the routes returned rate-limit headers.');
  for (const [p, { model, h }] of Object.entries(seen)) {
    const limits = Object.entries(h).filter(([k]) => !/reset/i.test(k)).map(([k, v]) => `${k}=${v}`).join(', ');
    L.push(`- **${p}** (e.g. \`${model}\`): ${limits || Object.keys(h).join(', ')}`);
  }
  const noRl = full.filter(e => !e.ratelimit_headers && !e.unavailable).map(e => '`' + e.model + '`');
  if (noRl.length) L.push(`- No rate-limit headers from: ${noRl.join(', ')}`);
  L.push('');

  L.push('## 9. Errors (deep probe; every call, including expected "unsupported" 4xx)', '');
  L.push('| Model route | calls | ok | unsupported 4xx | 429 | 5xx | timeouts | network | stream errors | transport error rate |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of full) {
    const c = e.counts || {};
    L.push(`| \`${e.model}\` | ${c.calls ?? 0} | ${c.ok ?? 0} | ${c.unsupported_4xx ?? 0} | ${c.rate_limited ?? 0} | ${c.server_5xx ?? 0} | ${c.timeouts ?? 0} | ${c.network ?? 0} | ${c.stream_errors ?? 0} | ${c.error_rate != null ? (c.error_rate * 100).toFixed(1) + '%' : '–'} |`);
  }
  if (sweep.length) {
    const sc = { calls: 0, ok: 0, transport: 0, unavailable: 0 };
    for (const e of sweep) {
      if (e.unavailable) sc.unavailable++;
      for (const t of Object.values(e.tests)) { sc.calls++; if (t.ok) sc.ok++; else if (t.error?.kind !== 'client') sc.transport++; }
    }
    L.push('', `Sweep: ${sweep.length} routes, ${sc.calls} calls, ${sc.ok} ok, ${sc.transport} transport errors, ${sc.unavailable} routes unusable (4xx on the first call).`);
  }
  L.push('');
  L.push('## Method', '');
  L.push('- Every request goes to `POST /v1/chat/completions` in the OpenAI shape; images are `image_url` data: URLs (JPEG; fixtures in `probe-assets/`, built by `probe-assets/make_assets.py`). The key is read from the environment and never logged or stored.');
  L.push('- A random tag ends every user message, so the gateway cannot serve a cached reply; the long system prompt stays identical, so provider prefix caches may apply on later trials (`usage.cached` in the JSON).');
  L.push('- 429/5xx/network failures on feature tests are retried once after a pause; both attempts count toward the error rate. A 4xx on a feature test means the route does not support that parameter.');
  L.push('- Output-cap test: a 600-word essay with a 40-token cap; honoured = completion tokens ≤ 44 and finish_reason = length. 32k/64k/128k = the route accepts that cap on a tiny reply.');
  L.push('- Re-run one route: `zsh -c \'source ~/.config/truefoundry/env && node ai/research/probe.mjs --phase full --models <id>\'` (merges into the JSON). `--phase report` rewrites this file and keeps the notes block.');
  fs.writeFileSync(MD_OUT, scrub(L.join('\n') + '\n'));
  console.log('wrote ' + path.relative(ROOT, MD_OUT));
}

// ---------------------------------------------------------------- compact summary (top of the JSON)
// One row per deep-probed route: what works, which parameters are accepted, median latencies (ms).
function buildSummary(db) {
  const out = {};
  for (const e of Object.values(db.full || {})) {
    const t = e.tests || {};
    const pass = n => (t[n] ? (t[n].skipped ? null : !!(t[n].ok && (t[n].check?.pass ?? true))) : null);
    const acc = n => (t[n] ? (t[n].skipped ? null : !!t[n].ok) : null);
    const l = e.latency || {};
    const cl = db.clean?.[e.model]?.latency;
    let filtered = 0;
    for (const r of [...Object.values(t), ...Object.values(l).flatMap(x => x.trials)]) if (r?.finish_reason === 'content_filter') filtered++;
    out[e.model] = {
      family: e.family, usable: !e.unavailable, unavailable: e.unavailable || undefined, slow: e.slow || undefined,
      served_by: resolvedMix(e), fallback_chain: e.routing_order || undefined,
      token_param: e.token_param ?? null, temperature_0: acc('temperature_0'),
      json_object: pass('json_object'),
      json_schema_strict: { default: pass('json_schema_strict'), effort_none: pass('json_schema_strict_effort_none'), effort_low: pass('json_schema_strict_effort_low') },
      tools_forced: { default: pass('tools_forced'), effort_none: pass('tools_forced_effort_none'), effort_low: pass('tools_forced_effort_low') },
      tools_auto: { default: pass('tools_auto'), effort_none: pass('tools_auto_effort_none'), effort_low: pass('tools_auto_effort_low') },
      vision: { one_1536: pass('image_1536'), two: pass('images_2'), four: pass('images_4'), body_6_6mb_accepted: acc('images_4_heavy') },
      reasoning_params_accepted: REASONING_VARIANTS.filter(v => t['reasoning_' + v.name]?.ok).map(v => v.name),
      reasoning_params_rejected: REASONING_VARIANTS.filter(v => t['reasoning_' + v.name] && !t['reasoning_' + v.name].ok && !t['reasoning_' + v.name].skipped).map(v => v.name),
      max_out_accepted: ['32k', '64k', '128k'].filter(k => t['max_out_' + k]?.ok),
      cap_40_honoured: !!(t.max_tokens_40?.check?.honoured || t.max_completion_tokens_40?.check?.honoured),
      fastest_setting: e.fast_control || null,
      latency_adjusted_p50_ms: {
        short_ns: l.short_ns?.p50_adj_total ?? null, short_stream_ttft: l.short_s?.p50_adj_first_content ?? null,
        big_ns: l.big_ns?.p50_adj_total ?? null, big_stream_ttft: l.big_s?.p50_adj_first_content ?? null,
        short_fast_ns: l.short_fast_ns?.p50_adj_total ?? null, big_fast_ns: l.big_fast_ns?.p50_adj_total ?? null,
      },
      latency_clean_wall_p50_ms: cl ? { short_ns: cl.short_ns?.p50_total ?? null, big_ns: cl.big_ns?.p50_total ?? null, short_fast_ns: cl.short_fast_ns?.p50_total ?? null, big_fast_ns: cl.big_fast_ns?.p50_total ?? null } : undefined,
      big_prompt_tokens: e.big_prompt_tokens ?? null,
      checks: {
        short_edit_right: [l.short_ns, l.short_s, l.short_fast_ns].filter(Boolean).reduce((a, x) => a + x.pass, 0) + '/' + [l.short_ns, l.short_s, l.short_fast_ns].filter(Boolean).reduce((a, x) => a + x.n, 0),
        dominoes_counted_right: (() => { const d = [l.big_ns, l.big_s, l.big_fast_ns].filter(Boolean).flatMap(x => x.trials).filter(x => x.check); return d.filter(x => x.check.dominoes_ok).length + '/' + d.length; })(),
        content_filter_replies: filtered,
      },
      transport_errors: e.counts ? `${e.counts.transport_errors}/${e.counts.calls}` : null,
    };
  }
  return out;
}

function writeSummary(db) {
  db.summary = buildSummary(db);
  const { summary, ...rest } = db;
  const ordered = { schema: rest.schema, updated: rest.updated, base_url: rest.base_url, method: rest.method, summary, ...rest };
  const tmp = OPT.out + '.tmp';
  fs.writeFileSync(tmp, scrub(JSON.stringify(ordered, null, 1)));
  fs.renameSync(tmp, OPT.out);
}

// ---------------------------------------------------------------- main
async function main() {
  const phases = OPT.phase === 'all' ? ['full', 'throttle', 'sweep', 'clean', 'report'] : OPT.phase.split(',');
  const db = loadDb();
  db.full ||= {}; db.sweep ||= {};
  if (phases.some(p => p !== 'report')) {
    if (!KEY) { console.error('TRUEFOUNDRY_API_KEY is not set; run inside: zsh -c \'source ~/.config/truefoundry/env && node ai/research/probe.mjs\''); process.exit(2); }
    await loadFixtures();
  } else {
    try { DIGEST = fs.readFileSync(path.join(ASSETS, 'catalog-digest.txt'), 'utf8'); } catch { /* report only */ }
  }
  for (const ph of phases) {
    if (ph === 'full') {
      const models = OPT.models || FULL_MODELS;
      console.log(`full phase: ${models.length} models, trials ${OPT.trials}, concurrency ${OPT.concurrency}, digest ${DIGEST.length} chars`);
      if (OPT.dry) { console.log(models.join('\n')); console.log('tests:', fullTests({}).map(t => t.name).join(', ')); continue; }
      await pool(models, OPT.concurrency, m => probeModel(m, db));
    } else if (ph === 'sweep') {
      const models = OPT.models || sweepModels();
      console.log(`sweep phase: ${models.length} routes`);
      if (OPT.dry) { console.log(models.join('\n')); continue; }
      await pool(models, OPT.concurrency, m => sweepModel(m, db));
    } else if (ph === 'throttle') {
      if (OPT.dry) { console.log('throttle phase on ' + (OPT.models?.[0] || THROTTLE_MODEL)); continue; }
      await throttlePhase(db);
    } else if (ph === 'clean') {
      const models = OPT.models || CLEAN_MODELS;
      console.log(`clean phase: ${models.length} models, one request in flight`);
      if (OPT.dry) { console.log(models.join('\n')); continue; }
      await pool(models, 1, m => cleanModel(m, db));
    } else if (ph === 'report') {
      writeReport(db);
      writeSummary(db);
    } else {
      console.error('unknown phase ' + ph); process.exit(2);
    }
  }
  if (!OPT.dry && phases.some(p => p !== 'report')) saveDb(db);
  AGENT.destroy();
  console.log(`done: ${CALLS} calls in ${((Date.now() - T0) / 1000).toFixed(0)} s`);
}

main().catch(e => { console.error(scrub(e?.stack || e)); process.exit(1); });
