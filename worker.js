// Daily Joy push server (Cloudflare Worker). Runs on its own, so alerts still arrive when the app is closed.
//
// What it does:
//   POST /sync         the phone sends its subscription and upcoming timed reminders
//   POST /due          the phone's service worker asks which reminders to show
//   POST /unsubscribe  the phone turns alerts off
//   GET  /add?c=CODE&t=TEXT   Siri/Shortcuts leaves a task in your inbox
//   POST /pull         the app collects the tasks waiting in its inbox
//   every minute (cron) it sends an empty "ping" to the phone when a reminder is due
//
// Needs: a KV namespace bound as DJ, a secret VAPID_JWK (made by make-keys.html),
// a variable VAPID_SUBJECT (mailto:your-email), and a cron trigger "* * * * *".

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_REMINDERS = 100;
const DAY = 86400000;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('Daily Joy push server is running.', { headers: CORS });
    // Siri / Shortcuts drops a task into your private inbox with a plain link (GET).
    if (request.method === 'GET' && url.pathname === '/add') return inboxAdd(url, env);
    if (request.method !== 'POST') return reply({ error: 'Use POST' }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: 'Bad JSON' }, 400); }
    if (url.pathname === '/pull') return inboxPull(body, env);
    if (url.pathname === '/sync') return sync(body, env);
    if (url.pathname === '/due') return due(body, env);
    if (url.pathname === '/unsubscribe') return unsubscribe(body, env);
    return reply({ error: 'Not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDue(env));
  }
};

// ---------- Endpoints ----------

async function sync(body, env) {
  const sub = body.subscription;
  if (!sub || !validEndpoint(sub.endpoint)) return reply({ error: 'Bad subscription' }, 400);
  const id = await idOf(sub.endpoint);
  const old = (await env.DJ.get('sub:' + id, 'json')) || { reminders: [] };
  const seen = new Map(old.reminders.map(function (r) { return [r.k, r]; }));
  const incoming = Array.isArray(body.reminders) ? body.reminders.slice(0, MAX_REMINDERS) : [];
  const reminders = incoming
    .filter(function (r) { return r && r.k && r.title && r.at && !isNaN(Date.parse(r.at)); })
    .map(function (r) {
      const prev = seen.get(String(r.k)) || {};   // keep the "already sent" state of reminders we know
      return {
        k: String(r.k), title: String(r.title).slice(0, 200), time: String(r.time || '').slice(0, 5),
        at: new Date(Date.parse(r.at)).toISOString(), pushed: !!prev.pushed, shown: !!prev.shown
      };
    });
  await env.DJ.put('sub:' + id, JSON.stringify({ endpoint: sub.endpoint, reminders: reminders }));
  const index = await getIndex(env);
  if (index.indexOf(id) < 0) { index.push(id); await env.DJ.put('index', JSON.stringify(index)); }
  return reply({ ok: true, count: reminders.length });
}

async function due(body, env) {
  const id = await idOf(String(body.endpoint || ''));
  const rec = await env.DJ.get('sub:' + id, 'json');
  if (!rec) return reply({ items: [] });
  const items = rec.reminders.filter(function (r) { return r.pushed && !r.shown; });
  if (items.length) {
    items.forEach(function (r) { r.shown = true; });
    rec.reminders = prune(rec.reminders, Date.now());
    await env.DJ.put('sub:' + id, JSON.stringify(rec));
  }
  return reply({ items: items.map(function (r) { return { title: r.title, time: r.time }; }) });
}

// Inbox for "Hey Siri, add to Daily Joy". The secret code (made by the app) is the only key; items wait up to 7 days.
function goodCode(c) { return /^[a-z0-9]{8,32}$/.test(String(c || '')); }
async function inboxAdd(url, env) {
  const code = url.searchParams.get('c'), text = String(url.searchParams.get('t') || '').trim().slice(0, 300);
  if (!goodCode(code) || !text) return reply({ error: 'Missing code or text' }, 400);
  const key = 'inbox:' + code;
  const list = (await env.DJ.get(key, 'json')) || [];
  list.push(text);
  await env.DJ.put(key, JSON.stringify(list.slice(-20)), { expirationTtl: 7 * 86400 });
  return reply({ ok: true, added: text });
}
async function inboxPull(body, env) {
  if (!goodCode(body.code)) return reply({ items: [] });
  const key = 'inbox:' + body.code;
  const list = (await env.DJ.get(key, 'json')) || [];
  if (list.length) await env.DJ.delete(key);
  return reply({ items: list });
}

async function unsubscribe(body, env) {
  const id = await idOf(String(body.endpoint || ''));
  await env.DJ.delete('sub:' + id);
  const index = (await getIndex(env)).filter(function (x) { return x !== id; });
  await env.DJ.put('index', JSON.stringify(index));
  return reply({ ok: true });
}

// ---------- Cron: send a ping for every reminder that is due ----------

async function runDue(env) {
  const now = Date.now();
  const index = await getIndex(env);
  const keep = [];
  for (const id of index) {
    if (await checkSub(id, now, env)) keep.push(id);
  }
  if (keep.length !== index.length) await env.DJ.put('index', JSON.stringify(keep));
}

// Returns false when the subscription is gone for good (the phone turned alerts off).
async function checkSub(id, now, env) {
  const key = 'sub:' + id;
  const rec = await env.DJ.get(key, 'json');
  if (!rec) return false;
  const due = rec.reminders.filter(function (r) { return !r.pushed && Date.parse(r.at) <= now; });
  if (!due.length) return true;
  const res = await sendPing(rec.endpoint, env);
  if (res === 'gone') { await env.DJ.delete(key); return false; }
  if (res === 'ok') due.forEach(function (r) { r.pushed = true; });
  rec.reminders = prune(rec.reminders, now);
  await env.DJ.put(key, JSON.stringify(rec));
  return true;
}

// Drops reminders that are over a day old, so the list stays small.
function prune(list, now) {
  return list.filter(function (r) { return Date.parse(r.at) > now - DAY; });
}

// ---------- Web Push (VAPID) ----------
// The ping has no body, so no encryption is needed. We only sign a short JWT with the private key.

async function sendPing(endpoint, env) {
  const jwt = await vapidJwt(new URL(endpoint).origin, env);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'high', Authorization: 'vapid t=' + jwt + ', k=' + publicKey(env) }
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'ok' : 'error';
}

let keyPromise = null;
function signingKey(env) {
  if (!keyPromise) keyPromise = crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyPromise;
}

async function vapidJwt(aud, env) {
  const head = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uStr(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT }));
  const data = new TextEncoder().encode(head + '.' + claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), data);
  return head + '.' + claims + '.' + b64u(new Uint8Array(sig));
}

// The public key is the uncompressed point 04 || x || y, base64url. The phone needs the same value.
function publicKey(env) {
  const j = JSON.parse(env.VAPID_JWK);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(b64uToBytes(j.x), 1);
  out.set(b64uToBytes(j.y), 33);
  return b64u(out);
}

// ---------- Helpers ----------

function reply(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
}
function validEndpoint(ep) {
  try { return new URL(String(ep)).protocol === 'https:'; } catch (e) { return false; }
}
async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 40);
}
async function getIndex(env) {
  return (await env.DJ.get('index', 'json')) || [];
}
function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uStr(str) { return b64u(new TextEncoder().encode(str)); }
function b64uToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
