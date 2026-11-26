// Daily Joy push server (Cloudflare Worker). Runs on its own, so alerts still arrive when the app is closed.
//
// What it does:
//   POST /sync         the phone sends its subscription and upcoming timed reminders
//   POST /due          the phone's service worker asks which reminders to show
//   POST /unsubscribe  the phone turns alerts off
//   GET  /add?c=CODE&t=TEXT   Siri/Shortcuts leaves a task in your inbox
//   POST /pull         the app collects the tasks waiting in its inbox
//   POST /parse        "Smart add": turns one sentence into tasks with Claude (optional)
//   every minute (cron) it sends an empty "ping" to the phone when a reminder is due
//
// Needs: a KV namespace bound as DJ, a secret VAPID_JWK (made by make-keys.html),
// a variable VAPID_SUBJECT (mailto:your-email), and a cron trigger "* * * * *".
// Optional, for Smart add: either an AI binding named AI (Cloudflare's own AI, no outside account),
// or a secret ANTHROPIC_API_KEY for Claude (and, if you like, a variable SMART_MODEL).
// With neither, /parse answers "not set up" and the app quietly uses its built-in parser.

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
    if (url.pathname === '/parse') return parseTasks(body, env, request);
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

// ---------- Smart add: one sentence in, a list of tasks out ----------
// The Anthropic key lives only here, as a Worker secret. Each phone gets a daily allowance (kept in KV).
const SMART_DAILY_LIMIT = 60;
const TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string' },
          time: { type: 'string' },
          category: { type: 'string', enum: ['general', 'work', 'home', 'health', 'shopping', 'learning', 'fun'] },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          repeat: { type: 'string', enum: ['', 'daily', 'weekdays', 'weekly', 'monthly'] }
        },
        required: ['title', 'date', 'time', 'category', 'priority', 'repeat'],
        additionalProperties: false
      }
    }
  },
  required: ['tasks'],
  additionalProperties: false
};
const SMART_RULES = [
  'You turn one spoken or typed sentence into a to-do list for a personal planner app.',
  'The sentence may hold one task or several. Return every task as its own item, in the order said.',
  'Use the person\'s own language for "title". Sentence case: capitalise only the first word and proper names, never every word. Keep names capitalised as the person wrote them (Omar, Sara, Hana). Keep the key detail (what, who, where), for example "Email the boss about the report", not "Email". Drop only filler like "remind me to", "I want you to", "and then", "maybe".',
  '"date" is YYYY-MM-DD, worked out from the current date and weekday given by the user. A weekday name alone means its next occurrence (never today unless said "today"). If no day is said for a task, or the day is vague ("some day", "sometime", "one day"), use "" (empty).',
  'A day or time said once can apply to the tasks that follow it when the sentence clearly groups them (for example "tomorrow gym at 6pm and call mom at 8" means both are tomorrow). A time belongs only to the task in the same clause: in "buy bread at 10 and call mom", mom gets no time. Never copy a time to a task that has none.',
  '"time" is 24-hour HH:MM. When the person gives a clock time with no am/pm (like "6:30" or "at 6") and the task is for today (or no day is said), pick the NEXT moment the clock will show that time after the current time: at 17:30, "6:30" means 18:30; at 08:00, "6:30" means 18:30 (the 06:30 has passed); at 05:00, "6:30" means 06:30; at 23:00, "7" means 07:00 tomorrow, so set date to tomorrow. When the task is for a later day with no am/pm, 1 to 6 means afternoon or evening ("tomorrow at 6:20" is 18:20, "Monday at 3" is 15:00) and 7 to 11 means morning, unless the sentence says otherwise. An explicit am/pm, "morning", "evening" or "tonight" always wins. For social or leisure events (cinema, movie, dinner, party, drinks, concert), a bare hour from 1 to 11 with no am/pm means evening: "cinema at 7" is 19:00. "morning" 09:00, "afternoon" 14:00, "evening" 18:00, "tonight" 20:00. If no time is said, use "". Never invent a time.',
  '"category" is one of general, work, home, health, shopping, learning, fun. Pick the best fit, or general.',
  '"priority" is normal unless the person says urgent/important/asap (high) or no rush/whenever (low).',
  '"repeat" is "" unless they say every day / daily (daily), weekdays (weekdays), every week / every Monday (weekly), every month (monthly). For a weekly repeat on a named day, set "date" to that day\'s next occurrence.',
  'Never merge unrelated tasks and never split one task in two ("salt and pepper" is one item).',
  'When one activity is said at several times ("calls at 9, 11 and 1"), make one task per time, and put the time in each title, for example "Client call at 9", "Client call at 11", "Client call at 1".',
  'If the sentence holds no task at all, return an empty list.'
].join('\n');

async function parseTasks(body, env, request) {
  if (!env.ANTHROPIC_API_KEY && !env.AI) return reply({ error: 'not_set_up' }, 503);
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!text) return reply({ error: 'No text' }, 400);

  // Daily allowance per phone (its private code), or per network address when there is no code.
  const who = goodCode(body.code) ? String(body.code) : 'ip-' + (request.headers.get('CF-Connecting-IP') || 'unknown');
  const day = new Date().toISOString().slice(0, 10);
  const rlKey = 'rl:' + who + ':' + day;
  const used = parseInt(await env.DJ.get(rlKey), 10) || 0;
  if (used >= SMART_DAILY_LIMIT) return reply({ error: 'limit' }, 429);
  await env.DJ.put(rlKey, String(used + 1), { expirationTtl: 2 * 86400 });

  const now = String(body.now || '').slice(0, 40), weekday = String(body.weekday || '').slice(0, 12), tz = String(body.tz || '').slice(0, 60);
  const question = 'Current local date and time: ' + now + ' (' + weekday + '), time zone ' + tz + '.\n\nDates for the next week (use these for weekday names):\n' + upcomingDays(now) + '\n\nSentence:\n' + text;
  // Claude when its key is set (best quality); otherwise Cloudflare's own AI, which needs no outside account.
  const data = env.ANTHROPIC_API_KEY ? await askClaude(env, question) : await askWorkersAI(env, question);
  if (!data || data.error) return reply({ error: (data && data.error) || 'bad_output' }, (data && data.status) || 502);

  const out = (Array.isArray(data.tasks) ? data.tasks : []).slice(0, 12).map(function (t) {
    return {
      title: String(t.title || '').trim().slice(0, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : '',
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : '',
      category: ['general', 'work', 'home', 'health', 'shopping', 'learning', 'fun'].indexOf(t.category) >= 0 ? t.category : 'general',
      priority: ['low', 'normal', 'high'].indexOf(t.priority) >= 0 ? t.priority : 'normal',
      repeat: ['daily', 'weekdays', 'weekly', 'monthly'].indexOf(t.repeat) >= 0 ? t.repeat : ''
    };
  }).filter(function (t) { return t.title; });
  out.forEach(function (t) { t.title = t.title.charAt(0).toUpperCase() + t.title.slice(1); });
  fixNames(out, text);
  fixClockTimes(out, text, now);
  return reply({ tasks: out });
}

// The AI sometimes lowercases a name ("Meet omar"). A word the person wrote with a capital letter in the middle
// of the sentence (a name, a weekday) keeps that capital in the titles. The first word of a sentence is skipped.
function fixNames(tasks, text) {
  const caps = {};
  const re = /[A-Za-zÀ-ɏ]+/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0];
    if (w.length < 2 || w[0] !== w[0].toUpperCase() || w[0] === w[0].toLowerCase()) continue;
    if (m.index === 0 || /[.!?]\s*$/.test(text.slice(0, m.index))) continue;
    caps[w.toLowerCase()] = w;
  }
  tasks.forEach(function (t) {
    t.title = t.title.replace(re, function (w) { return Object.prototype.hasOwnProperty.call(caps, w.toLowerCase()) ? caps[w.toLowerCase()] : w; });
  });
}

// Plain clock times ("6:30", "at 3") with no am/pm or part of the day are settled here in code, not by the AI:
// for today it is the NEXT time the clock shows it, for a later day 1-6 is afternoon/evening and 7-11 is morning.
// If the sentence says am/pm/morning/evening/etc. we trust the AI's reading.
function fixClockTimes(tasks, text, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(now);
  if (!m) return;
  if (/\d\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b(morning|noon|afternoon|evening|tonight|midnight)\b/i.test(text)) return;
  if (/\b[01]\d:[0-5]\d\b|\b2[0-3]:[0-5]\d\b/.test(text)) return;   // typed in 24-hour style, like 08:00 or 18:30
  const today = m[1] + '-' + m[2] + '-' + m[3], nowMin = +m[4] * 60 + +m[5];
  tasks.forEach(function (t) {
    if (!t.time) return;
    let h = +t.time.slice(0, 2);
    const mi = +t.time.slice(3);
    // The AI may have already turned "6:30" into 18:30. If the sentence only says 6 (not 18), go back to the 12-hour reading.
    if (h >= 13 && h <= 18 && new RegExp('(^|[^\\d])' + (h - 12) + '(?!\\d)').test(text) && !new RegExp('(^|[^\\d])' + h + '(?!\\d)').test(text)) h -= 12;
    // Social plans (cinema, dinner, party...) at a bare hour are evening plans: "cinema at 7" is 19:00.
    if (/\b(cinema|movie|dinner|party|concert|drinks|date|wedding|game)\b/i.test(t.title) && h >= 1 && h <= 11) {
      t.time = ('0' + (h + 12)).slice(-2) + ':' + ('0' + mi).slice(-2);
      return;
    }
    if (h < 1 || h > 11) return;   // 12 and 13+ are left alone; only 1 to 11 can mean two times of day
    const date = t.date || today;
    let hour = h;
    if (date === today) {
      if (h * 60 + mi > nowMin) hour = h;                          // the morning one is still ahead
      else if ((h + 12) * 60 + mi > nowMin) hour = h + 12;         // the evening one is still ahead
      else { hour = h; t.date = addDays(today, 1); }               // both passed: tomorrow morning
    } else if (h <= 6 && !t.repeat) hour = h + 12;   // a repeating routine at 6:30 ("weekdays at 6:30") is a morning one
    t.time = ('0' + hour).slice(-2) + ':' + ('0' + mi).slice(-2);
  });
}
function addDays(ymd, n) {
  const p = ymd.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * DAY).toISOString().slice(0, 10);
}

// Lists today and the next 7 days with their weekday names, so the model looks dates up instead of counting.
function upcomingDays(now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(now);
  if (!m) return '(unknown)';
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(base + i * DAY);
    const label = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '';
    lines.push(names[d.getUTCDay()] + ' ' + d.toISOString().slice(0, 10) + label);
  }
  return lines.join('\n');
}

// Claude (Opus 5.5 unless SMART_MODEL says otherwise). Returns the parsed object, or { error, status }.
async function askClaude(env, question) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 25000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.SMART_MODEL || 'claude-opus-5-5',
        max_tokens: 4000,
        system: SMART_RULES,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: TASK_SCHEMA } },
        messages: [{ role: 'user', content: question }]
      })
    });
  } catch (e) {
    return { error: 'upstream_timeout', status: 504 };
  } finally { clearTimeout(timer); }
  if (!res.ok) return { error: 'upstream_' + res.status, status: 502 };

  let msg;
  try { msg = await res.json(); } catch (e) { return { error: 'bad_upstream', status: 502 }; }
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return { error: 'unusable', status: 502 };
  const block = (msg.content || []).filter(function (b) { return b.type === 'text'; })[0];
  try { return JSON.parse(block.text); } catch (e) { return { error: 'bad_output', status: 502 }; }
}

// Cloudflare Workers AI (needs an AI binding named AI). Its JSON mode returns the parsed object under "response".
async function askWorkersAI(env, question) {
  let out;
  try {
    out = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'system', content: SMART_RULES }, { role: 'user', content: question }],
      response_format: { type: 'json_schema', json_schema: TASK_SCHEMA },
      max_tokens: 1500
    });
  } catch (e) { return { error: 'upstream_ai', status: 502 }; }
  const data = out && out.response;
  if (data && typeof data === 'object') return data;
  try { return JSON.parse(String(data || '')); } catch (e) { return { error: 'bad_output', status: 502 }; }
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
