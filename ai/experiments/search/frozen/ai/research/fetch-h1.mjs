// fetchH1(url, init): a drop-in for the parts of fetch() that ai/core.mjs uses, over HTTP/1.1.
//
// Why: Node's built-in fetch (undici 8 in Node 26) negotiates HTTP/2 with the TrueFoundry gateway and
// sends every request of the process over ONE connection, where the gateway serves them one after
// another. Measured 2026-10-15 (ai/research/gateway-probe.md, section 6): 4 tiny calls in flight cost
// ~1.5 s extra each over fetch/HTTP/2 but ~45 ms over HTTP/1.1 with a keep-alive socket per request,
// and throughput was 3-4x higher. A single call per process is not affected; parallel calls in one
// process (benchmark runner, observe+plan together, a server handling several users) are.
//
// Keep-alive race: when the server has closed an idle socket, the next request on it fails at once with
// ECONNRESET / "socket hang up" (seen in the probe right after a gateway 502). As Node's docs advise, a
// request that fails that way on a REUSED socket, before any response, is retried once on a fresh socket.
//
// Usage: import { fetchH1 } from './research/fetch-h1.mjs'; callModel(step, { ..., fetch: fetchH1 })
// Supports: method, headers (object or Headers), string/Buffer body, AbortSignal.
// Returns: { ok, status, statusText, headers: Headers, body: AsyncIterable<Buffer>, text(), json() }.

import http from 'node:http';
import https from 'node:https';

const AGENTS = {
  'https:': new https.Agent({ keepAlive: true, maxSockets: 16 }),
  'http:': new http.Agent({ keepAlive: true, maxSockets: 16 }),
};

export async function fetchH1(url, init = {}) {
  try {
    return await once(url, init);
  } catch (err) {
    if (err?.reusedSocket && !init.signal?.aborted && (err.code === 'ECONNRESET' || /socket hang up/i.test(err.message))) return once(url, init);
    throw err;
  }
}

function once(url, init) {
  const u = new URL(String(url));
  const mod = u.protocol === 'https:' ? https : http;
  const headers = {};
  if (init.headers) {
    const entries = typeof init.headers.entries === 'function' ? init.headers.entries() : Object.entries(init.headers);
    for (const [k, v] of entries) headers[k.toLowerCase()] = v;
  }
  const body = init.body == null ? null : typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.from(init.body);
  if (body) headers['content-length'] = String(body.length);
  const signal = init.signal;
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError', cause: signal?.reason });
    if (signal?.aborted) { reject(abortError()); return; }
    const req = mod.request(u, { method: init.method || 'GET', headers, agent: AGENTS[u.protocol] }, res => {
      const h = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
        try { h.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* skip malformed header */ }
      }
      let used = false;
      const readAll = async () => {
        if (used) throw new TypeError('Body already used');
        used = true;
        const chunks = [];
        for await (const c of res) chunks.push(c);
        return Buffer.concat(chunks).toString('utf8');
      };
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        statusText: res.statusMessage || '',
        headers: h,
        body: res,
        text: readAll,
        json: async () => JSON.parse(await readAll()),
      });
    });
    const onAbort = () => req.destroy(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', err => {
      signal?.removeEventListener('abort', onAbort);
      if (req.reusedSocket) err.reusedSocket = true;
      reject(err);
    });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.end(body ?? undefined);
  });
}

export default fetchH1;
