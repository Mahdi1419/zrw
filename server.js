import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ServerWebSocket, acceptWebSocketUpgrade } from './runtime/websocket.js';
import { D1Compat } from './runtime/d1.js';
import { installCacheCompat } from './runtime/cache.js';
import { transformWorkerSource } from './runtime/transform.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/var/data';
const FALLBACK_DATA_DIR = path.join(__dirname, 'data');
let dataDir = DATA_DIR;
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch {
  dataDir = FALLBACK_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
}

const bundledSource = path.join(__dirname, 'Source.js');
const persistedSource = path.join(dataDir, 'Source.js');
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'zeus.db');
const generatedPath = path.join(dataDir, '.zeus-worker-render.mjs');
const updateSourceUrl = process.env.UPDATE_SOURCE_URL || 'https://raw.githubusercontent.com/panel-zeus/Z-E-U-S/refs/heads/main/zeus.obfuscated.js';

installCacheCompat();
globalThis.WebSocket = ServerWebSocket;
globalThis.__RENDER_MODE = true;
globalThis.__RENDER_PUBLIC_PORT = String(process.env.PUBLIC_PORT || '443');
globalThis.__RENDER_ALLOW_EDGE_IPS = /^(1|true|yes)$/i.test(process.env.ALLOW_CLOUDFLARE_EDGE_IPS || '0');

const DB = new D1Compat(dbPath);
const env = {
  ...process.env,
  DB,
  RUNTIME: 'render',
  WORKER_NAME: process.env.WORKER_NAME || 'zeus-render'
};
const pendingTasks = new Set();
const ctx = {
  waitUntil(promise) {
    const p = Promise.resolve(promise).catch((err) => console.error('[waitUntil]', err));
    pendingTasks.add(p);
    p.finally(() => pendingTasks.delete(p));
  },
  passThroughOnException() {}
};

let worker;
let loadedVersion = 0;

function getSourceText() {
  const selected = fs.existsSync(persistedSource) ? persistedSource : bundledSource;
  return fs.readFileSync(selected, 'utf8');
}

async function loadWorkerFromSource(sourceText, persist = false) {
  const socketUrl = pathToFileURL(path.join(__dirname, 'runtime/cloudflare-sockets.js')).href;
  const transformed = transformWorkerSource(sourceText, socketUrl);
  fs.writeFileSync(generatedPath, transformed, 'utf8');
  if (persist) {
    const tmp = persistedSource + '.tmp';
    fs.writeFileSync(tmp, sourceText, 'utf8');
    fs.renameSync(tmp, persistedSource);
  }
  loadedVersion++;
  const mod = await import(pathToFileURL(generatedPath).href + `?v=${loadedVersion}`);
  if (!mod.default || typeof mod.default.fetch !== 'function') throw new Error('Transformed worker has no default fetch() export');
  worker = mod.default;
}

await loadWorkerFromSource(getSourceText());

function headerValue(req, name) {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v || '');
}

function clientIp(req) {
  const cf = headerValue(req, 'cf-connecting-ip');
  if (cf) return cf;
  const xff = headerValue(req, 'x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headerValue(req, 'x-real-ip') || req.socket.remoteAddress || 'unknown';
}

function requestUrl(req) {
  const proto = headerValue(req, 'x-forwarded-proto') || (req.socket.encrypted ? 'https' : 'http');
  const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host') || `localhost:${PORT}`;
  return `${proto}://${host}${req.url || '/'}`;
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else headers.set(k, v);
  }
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', clientIp(req));
  return headers;
}

async function readBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toFetchRequest(req, body) {
  const init = { method: req.method, headers: requestHeaders(req) };
  if (req.method !== 'GET' && req.method !== 'HEAD' && body !== undefined) init.body = body;
  return new Request(requestUrl(req), init);
}

function json(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, ...extraHeaders });
  res.end(body);
}

function cookieMap(cookieHeader = '') {
  const result = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}

async function isAdminAuthorized(req) {
  const row = await DB.prepare("SELECT value FROM settings WHERE key = 'panel_password'").first();
  if (!row?.value) return true;
  return cookieMap(headerValue(req, 'cookie')).panel_session === row.value;
}

async function handleRenderApi(req, res, url, bodyBuffer) {
  if (url.pathname === '/healthz') {
    json(res, 200, { ok: true, runtime: 'render' });
    return true;
  }

  if (url.pathname === '/api/recover' && req.method === 'POST') {
    const body = JSON.parse(bodyBuffer?.toString('utf8') || '{}');
    const recoveryToken = process.env.RECOVERY_TOKEN || '';
    if (!recoveryToken) {
      json(res, 503, { error: 'RECOVERY_TOKEN در Render Environment تنظیم نشده است' });
      return true;
    }
    if (!body.api_token || body.api_token !== recoveryToken) {
      json(res, 401, { error: 'Recovery token is invalid' });
      return true;
    }
    await DB.prepare("DELETE FROM settings WHERE key = 'panel_password'").run();
    json(res, 200, { success: true });
    return true;
  }

  if (url.pathname === '/api/auto-update-setup' && req.method === 'POST') {
    if (!await isAdminAuthorized(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    const body = JSON.parse(bodyBuffer?.toString('utf8') || '{}');
    const current = await DB.prepare("SELECT value FROM settings WHERE key = 'auto_update'").first();
    const enabled = current ? current.value === '1' : true;
    if (body.action === 'check') {
      json(res, 200, { has_token: true, auto_update: enabled, runtime: 'render' });
      return true;
    }
    if (body.action === 'enable' || body.action === 'disable') {
      const value = body.action === 'enable' ? '1' : '0';
      await DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update', ?)").bind(value).run();
      json(res, 200, { success: true });
      return true;
    }
  }

  if (url.pathname === '/api/update-panel' && req.method === 'POST') {
    if (!await isAdminAuthorized(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const upstream = await fetch(updateSourceUrl, { headers: { 'user-agent': 'ZEUS-Render/1.0', 'cache-control': 'no-cache' }, signal: controller.signal });
      clearTimeout(timer);
      if (!upstream.ok) throw new Error(`Update source returned ${upstream.status}`);
      const sourceText = await upstream.text();
      if (!sourceText.includes('export default') || !sourceText.includes('cloudflare:sockets') || !sourceText.includes('HTML_TEMPLATES')) {
        throw new Error('Downloaded source does not look like a compatible ZEUS worker');
      }
      await loadWorkerFromSource(sourceText, true);
      json(res, 200, { success: true, runtime: 'render' });
    } catch (err) {
      json(res, 400, { error: err?.message || String(err) });
    }
    return true;
  }

  return false;
}

async function sendFetchResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    headers[key] = value;
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length) headers['set-cookie'] = setCookies;
  else {
    const one = response.headers.get('set-cookie');
    if (one) headers['set-cookie'] = one;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!('content-length' in headers)) headers['content-length'] = bytes.length;
  res.writeHead(response.status, headers);
  res.end(bytes);
}

const server = http.createServer(async (req, res) => {
  try {
    const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req);
    const url = new URL(requestUrl(req));
    if (await handleRenderApi(req, res, url, body)) return;
    const request = await toFetchRequest(req, body);
    const response = await worker.fetch(request, env, ctx);
    await sendFetchResponse(res, response);
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) json(res, 500, { error: 'Internal Server Error' });
    else res.destroy();
  }
});

server.on('upgrade', (req, socket, head) => {
  const ws = acceptWebSocketUpgrade(req, socket, head, { maxPayload: 64 * 1024 * 1024 });
  if (!ws) return;
  ws.binaryType = 'arraybuffer';
  (async () => {
    try {
      const request = await toFetchRequest(req, undefined);
      Object.defineProperty(request, '__renderWebSocket', { value: ws, enumerable: false });
      await worker.fetch(request, env, ctx);
    } catch (err) {
      console.error('[websocket]', err);
      try { ws.close(1011, 'Internal Server Error'); } catch {}
    }
  })();
});

const flushAndClose = async () => {
  try { await Promise.allSettled([...pendingTasks]); } catch {}
  try { DB.close(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', flushAndClose);
process.on('SIGINT', flushAndClose);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ZEUS Render listening on 0.0.0.0:${PORT}`);
  console.log(`SQLite: ${dbPath}`);
});
