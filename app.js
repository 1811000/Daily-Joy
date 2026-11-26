/* Daily Joy — web / iPhone version.
   Tasks live in this device's localStorage, using the same JSON shape as the
   desktop app's tasks.json, so Export/Import moves tasks between the two. */
(function () {
  'use strict';

  // ---------- Data & constants ----------
  var STORE = 'dailyjoy.tasks', THEME = 'dailyjoy.theme', HINT = 'dailyjoy.hintClosed';

  // Alerts when the app is closed. Fill these in after deploying push-server (see push-server\README.md).
  // PUSH_SERVER must also be set to the same address in sw.js.
  var PUSH_SERVER = 'https://dailyjoy-push.asser1811.workers.dev';
  var VAPID_PUBLIC = 'BPUNVuOyD3rhnzWltsrevil4lK-XCImho4chO5_s5x09Hoa6nQ912ocNqgDUwv-nq02kIBVKrMMW9muxHi-Z-yI';
  var PUSHON = 'dailyjoy.push';
  var pushOn = false; try { pushOn = localStorage.getItem(PUSHON) === '1'; } catch (e) {}
  var pushTimer = null, pushLast = 0;

  var CATS = [
    { key: 'general',  name: 'General',  emoji: '✨', color: '#8b5cf6' },
    { key: 'work',     name: 'Work',     emoji: '💼', color: '#3b82f6' },
    { key: 'home',     name: 'Home',     emoji: '🏠', color: '#f97316' },
    { key: 'health',   name: 'Health',   emoji: '💪', color: '#10b981' },
    { key: 'shopping', name: 'Shopping', emoji: '🛒', color: '#ec4899' },
    { key: 'learning', name: 'Learning', emoji: '📚', color: '#0ea5e9' },
    { key: 'fun',      name: 'Fun',      emoji: '🎉', color: '#f59e0b' }
  ];
  var PRIOS = [
    { name: 'Low',    emoji: '🌿', color: '#14b8a6' },
    { name: 'Normal', emoji: '⭐', color: '#8b5cf6' },
    { name: 'High',   emoji: '🔥', color: '#ff5468' }
  ];
  var QUOTES = [
    "Small steps every day add up to big things.",
    "You don't have to do it all. Just the next thing.",
    "Done is better than perfect.",
    "Progress, not perfection.",
    "Be proud of every little win today.",
    "One task at a time. You've got this!",
    "Start where you are. Use what you have. Do what you can.",
    "Make today so awesome that yesterday gets jealous.",
    "Focus on the step in front of you, not the whole staircase.",
    "Your future self will thank you.",
    "Celebrate the small stuff, it adds up!",
    "Take a deep breath. Then begin.",
    "Rest is productive too. Be kind to yourself.",
    "A little progress each day adds up to big results."
  ];
  var CHEERS = ["Nice one! ✨", "Boom, done! 💥", "One less thing! 🙌", "You rock! 🎸", "Crushed it! 💪",
                "Look at you go! 🚀", "Woohoo! 🎈", "Checked off! ✅", "Keep it rolling! 🌟"];
  var CONFETTI = ['#ff6384', '#ffa743', '#ffd23f', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#0ea5e9'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TICKS_EPOCH = 621355968000000000; // .NET ticks at 1970-01-01, so "Created" matches the desktop app

  function $(id) { return document.getElementById(id); }
  function cat(key) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === key) return CATS[i]; return CATS[0]; }
  function prio(p) { return PRIOS[p] || PRIOS[1]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function newId() {
    if (window.crypto && crypto.getRandomValues) {
      var b = new Uint8Array(16); crypto.getRandomValues(b);
      return Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    }
    return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, 32);
  }
  function nowTicks() { return Date.now() * 10000 + TICKS_EPOCH; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  // ---------- Dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function diffDays(a, b) { return Math.round((a - b) / 86400000); }
  function relative(d) {
    var n = diffDays(d, today());
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    return n > 1 ? 'In ' + n + ' days' : (-n) + ' days ago';
  }
  function shortDate(d) { return WD[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate(); }
  function friendly(d) { var n = diffDays(d, today()); return (n >= -1 && n <= 1) ? relative(d).toLowerCase() : shortDate(d); }
  function timeDisp(hhmm) {
    if (!hhmm) return '';
    var p = hhmm.split(':'), h = +p[0], m = p[1];
    return ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  // "Call mom at 6pm" -> { rest: "Call mom", time: "18:00" }. Needs am/pm or minutes, so "at 3" alone is left alone.
  var TIME_RX = /\s+(?:at|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i;
  function extractTime(text) {
    var m = TIME_RX.exec(text);
    if (!m) return null;
    var hasMin = m[2] != null, ap = m[3];
    if (!hasMin && !ap) return null;
    var h = +m[1], mi = hasMin ? +m[2] : 0;
    if (mi > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      var pm = /^p/i.test(ap);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else if (h > 23) return null;
    var rest = text.slice(0, m.index).trim();
    if (!rest) return null;
    return { rest: rest, time: pad(h) + ':' + pad(mi) };
  }

  // ---------- Storage ----------
  // Repeating tasks: every repeat is a normal task (so it can be ticked off on its own day) that carries a
  // Series id. The recipe for the series lives in `series`, and fillRepeats() keeps the coming weeks filled in.
  var SERIES = 'dailyjoy.series';
  var REPEAT = {
    daily:    { name: 'Daily',    say: 'every day',     sub: 'Every single day', ahead: 30 },
    weekdays: { name: 'Weekdays', say: 'every weekday', sub: 'Monday to Friday', ahead: 30 },
    weekly:   { name: 'Weekly',   say: 'every week',    sub: 'Same day each week', ahead: 60 },
    monthly:  { name: 'Monthly',  say: 'every month',   sub: 'Same date each month', ahead: 100 }
  };
  var REPEAT_KEYS = ['daily', 'weekdays', 'weekly', 'monthly'];
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var p = s.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getFullYear() === +p[0] && d.getMonth() === +p[1] - 1 && d.getDate() === +p[2];
  }
  function normalize(t) {
    var sid = t.Series ? String(t.Series) : '';
    return {
      Series: sid,
      Repeat: sid && REPEAT[t.Repeat] ? t.Repeat : '',
      Id: (t.Id && /^[A-Za-z0-9_-]{1,64}$/.test(String(t.Id))) ? String(t.Id) : newId(),   // only safe characters: it goes into the page markup
      Title: String(t.Title || '').trim().slice(0, 200) || 'Untitled',
      Notes: String(t.Notes || '').slice(0, 5000),
      Date: validDate(t.Date) ? t.Date : key(today()),
      Time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.Time || '') ? t.Time : '',
      Priority: [0, 1, 2].indexOf(+t.Priority) >= 0 ? +t.Priority : 1,
      Done: !!t.Done,
      Created: +t.Created || nowTicks(),
      Category: cat(t.Category).key,
      Top: !!t.Top,       // pinned to the top of its day (max 3)
      Nag: !!t.Nag        // keeps reminding every 5-10 minutes until it is done
    };
  }
  function load() {
    try { var a = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(a) ? a.map(normalize) : []; }
    catch (e) { return []; }
  }
  function loadSeries() {
    try { var o = JSON.parse(localStorage.getItem(SERIES) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(tasks)); localStorage.setItem(SERIES, JSON.stringify(series)); queuePush(); }
    catch (e) { say('Could not save on this device 😢'); }
  }
  function snapshot() { return JSON.parse(JSON.stringify(tasks)); }

  // ---------- State ----------
  var tasks = load();
  var series = loadSeries();
  var view = today();
  var filter = 'all', catFilter = null;
  var newCat = 'general', newPrio = 1, newTime = '', newRepeat = '';

  // ---------- Repeats ----------
  function nextOccurrence(rule, from, anchor) {
    var d = new Date(from);
    if (rule === 'daily') return addDays(d, 1);
    if (rule === 'weekdays') { do { d = addDays(d, 1); } while (d.getDay() === 0 || d.getDay() === 6); return d; }
    if (rule === 'weekly') return addDays(d, 7);
    var y = d.getFullYear(), m = d.getMonth() + 1, dim = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(anchor.getDate(), dim)); // monthly keeps the original date (31st -> 30th/28th when needed)
  }
  function nextWeekday(from, wd) { return addDays(from, (wd - from.getDay() + 7) % 7); }
  // Makes sure every series has its upcoming tasks created. Missed days in the past are not recreated.
  function fillRepeats() {
    var tk = key(today()), changed = false;
    Object.keys(series).forEach(function (id) {
      var s = series[id];
      if (!s || !REPEAT[s.Rule] || !/^\d{4}-\d{2}-\d{2}$/.test(s.Through || '')) return;
      var horizon = key(addDays(today(), REPEAT[s.Rule].ahead));
      var anchor = parseKey(s.Anchor || s.Through), d = parseKey(s.Through), guard = 0;
      while (guard++ < 800) {
        d = nextOccurrence(s.Rule, d, anchor);
        var k = key(d);
        if (k > horizon) break;
        s.Through = k; changed = true;
        if (k < tk) continue;
        if (!tasks.some(function (x) { return x.Series === id && x.Date === k; })) {
          tasks.push(normalize({ Title: s.Title, Notes: s.Notes, Date: k, Time: s.Time, Priority: s.Priority, Category: s.Category, Nag: s.Nag,
                                 Series: id, Repeat: s.Rule, Created: nowTicks() }));
        }
      }
    });
    if (changed) save();
  }
  // Starts a repeat from a task: the task is the first one, the rest get created by fillRepeats().
  function startSeries(t, rule) {
    var id = newId();
    t.Series = id; t.Repeat = rule;
    series[id] = { Rule: rule, Title: t.Title, Notes: t.Notes, Time: t.Time, Priority: t.Priority, Category: t.Category, Nag: t.Nag, Anchor: t.Date, Through: t.Date };
  }
  // "Gym every Monday at 6pm" -> { rest: "Gym at 6pm", rule: "weekly", weekday: 1 }
  var EVERY_RX = /(?:^|\s)every\s+(day|weekdays?|week|month|(?:sun|mon|tues|wednes|thurs|fri|satur)day)(?=\s|$|[.,!?])/i;
  var REPEAT_END_RX = /\s+(daily|weekly|monthly|weekdays)\s*[.!]?$/i;
  function extractRepeat(text) {
    var m = EVERY_RX.exec(text), word, rest;
    if (m) { word = m[1].toLowerCase(); rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(); }
    else if ((m = REPEAT_END_RX.exec(text))) { word = m[1].toLowerCase(); rest = text.slice(0, m.index).trim(); }
    else return null;
    if (!rest) return null;
    var wd = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(word);
    if (wd >= 0) return { rest: rest, rule: 'weekly', weekday: wd };
    var rule = /^day|^daily/.test(word) ? 'daily' : /^weekday/.test(word) ? 'weekdays' : /^week/.test(word) ? 'weekly' : 'monthly';
    return { rest: rest, rule: rule, weekday: null };
  }

  // ---------- Rendering ----------
  var RING_C = 2 * Math.PI * 35;

  function tasksOn(k) { return tasks.filter(function (t) { return t.Date === k; }); }
  // The (up to) three pinned tasks of a day that are still to do: { id: 1 }
  var topIds = {};
  function computeTop(list) {
    var o = {};
    list.filter(function (t) { return t.Top && !t.Done; }).sort(function (a, b) { return a.Created - b.Created; })
      .slice(0, 3).forEach(function (t) { o[t.Id] = 1; });
    return o;
  }
  function sortTodo(a, b) {
    if (!!topIds[a.Id] !== !!topIds[b.Id]) return topIds[a.Id] ? -1 : 1;
    if (!!a.Time !== !!b.Time) return a.Time ? -1 : 1;
    if (a.Time !== b.Time) return a.Time < b.Time ? -1 : 1;
    if (a.Priority !== b.Priority) return b.Priority - a.Priority;
    return a.Created - b.Created;
  }

  // The name the user typed in Options (shown in the greeting). Empty = no name.
  var NAME = 'dailyjoy.name';
  function myName() { try { return (localStorage.getItem(NAME) || '').trim(); } catch (e) { return ''; } }
  function greeting() {
    var n = diffDays(view, today()), who = myName() ? ', ' + myName() : '';
    if (n > 0) return '📅 Planning ahead' + who + ', nice!';
    if (n < 0) return '🕰 Looking back' + (who ? who : '');
    var h = new Date().getHours();
    if (h < 5) return '🌙 Burning the midnight oil' + who + '?';
    if (h < 12) return '☀️ Good morning' + (who || ', sunshine') + '!';
    if (h < 17) return '🌤 Good afternoon' + who + '!';
    if (h < 21) return '🌆 Good evening' + who + '!';
    return '🌙 Winding down for the night' + who;
  }

  function render() {
    var vk = key(view), dayTasks = tasksOn(vk);
    var total = dayTasks.length, done = dayTasks.filter(function (t) { return t.Done; }).length;
    var ratio = total ? done / total : 0;
    topIds = computeTop(dayTasks);

    // hero
    $('greet').textContent = greeting();
    var st = streakCount();
    $('streak').hidden = st < 2;
    $('streak').textContent = '🔥 ' + st + ' days in a row finishing everything';
    var rel = relative(view), n = diffDays(view, today());
    $('title').textContent = (n >= -1 && n <= 1) ? rel : WDL[view.getDay()];
    var msg;
    if (!total) msg = 'Nothing planned yet. Add something fun! 🎈';
    else if (done === total) msg = 'All ' + total + ' done. Amazing! 🎉';
    else if (!done) msg = total + ' to go. Let’s get started! 🚀';
    else msg = done + ' of ' + total + ' done. ' + (ratio < 0.5 ? 'Great start! 🌱' : 'Almost there! 💪');
    $('sub').textContent = shortDate(view) + ' · ' + msg;
    var bar = $('ringBar');
    bar.style.strokeDasharray = RING_C;
    bar.style.strokeDashoffset = RING_C * (1 - ratio);
    $('ringLabel').textContent = !total ? '✨' : (done === total ? '🎉' : Math.round(ratio * 100) + '%');

    renderWeek();
    renderAddChips();

    // overdue banner (only when looking at today)
    var tk = key(today());
    var late = n === 0 ? tasks.filter(function (t) { return !t.Done && t.Date < tk; }) : [];
    $('banner').hidden = !late.length;
    if (late.length) $('bannerText').textContent = '⏰ ' + late.length + ' unfinished task' + (late.length > 1 ? 's' : '') + ' from earlier days';

    // filters
    var shown = dayTasks.filter(function (t) { return !catFilter || t.Category === catFilter; });
    var sTodo = shown.filter(function (t) { return !t.Done; }).sort(sortTodo);
    var sDone = shown.filter(function (t) { return t.Done; }).sort(function (a, b) { return a.Created - b.Created; });
    $('nAll').textContent = shown.length; $('nTodo').textContent = sTodo.length; $('nDone').textContent = sDone.length;
    document.querySelectorAll('.filters button').forEach(function (b) {
      var on = b.dataset.f === filter; b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
    });

    renderCats(dayTasks);

    // list
    var html = '';
    var showTodo = filter !== 'done', showDone = filter !== 'todo';
    if (showTodo) sTodo.forEach(function (t) { html += card(t); });
    if (showDone && sDone.length) {
      if (showTodo && sTodo.length) html += '<div class="section-h">Done · ' + sDone.length + '</div>';
      sDone.forEach(function (t) { html += card(t); });
    }
    $('list').innerHTML = html;

    var visible = (showTodo ? sTodo.length : 0) + (showDone ? sDone.length : 0);
    var e = $('empty');
    e.hidden = visible > 0;
    if (!visible) {
      var em;
      if (!total) em = ['🌤️', 'A fresh, empty day!', 'Type a task above and press Enter ✨'];
      else if (filter === 'todo' && !sTodo.length && !catFilter) em = ['🎉', 'Nothing left to do!', 'Everything here is done. Treat yourself 🍦'];
      else if (filter === 'done' && !sDone.length && !catFilter) em = ['💪', 'Nothing finished yet', 'You’ve got this. Pick one small task to start!'];
      else em = ['🔍', 'Nothing here', 'Try another filter'];
      e.innerHTML = '<div class="e-emoji">' + em[0] + '</div><div class="e-title">' + em[1] + '</div><div class="e-sub">' + em[2] + '</div>';
    }

    var start = new Date(view.getFullYear(), 0, 0);
    $('quote').textContent = '“' + QUOTES[diffDays(view, start) % QUOTES.length] + '”';

    var dark = document.documentElement.dataset.theme === 'dark';
    $('themeBtn').textContent = dark ? '☀️' : '🌙';
    $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');

    // app icon badge: how many tasks are still to do today (only shown when the phone allows it)
    var left = tasksOn(key(today())).filter(function (t) { return !t.Done; }).length;
    if (left !== badgeShown) {
      badgeShown = left;
      try {
        if (left && navigator.setAppBadge) navigator.setAppBadge(left).catch(function () {});
        else if (!left && navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
      } catch (e) {}
    }
  }
  var badgeShown = -1;

  function card(t) {
    var c = cat(t.Category), p = prio(t.Priority), meta = '';
    var isLate = !t.Done && t.Time && t.Date === key(today()) && t.Time < pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
    if (topIds[t.Id]) meta += '<span class="tag" style="--tc:#ff6384">📌 Top</span>';
    if (t.Nag && !t.Done && t.Time) meta += '<span class="tag" style="--tc:#7a6e8e">🔔 Keeps reminding</span>';
    if (t.Time) meta += '<span class="tag" style="--tc:' + (isLate ? '#ef4444' : '#7a6e8e') + '">' + (isLate ? '⏰ ' : '🕒 ') + timeDisp(t.Time) + '</span>';
    if (t.Priority !== 1) meta += '<span class="tag" style="--tc:' + p.color + '">' + p.emoji + ' ' + p.name + '</span>';
    if (t.Repeat) meta += '<span class="tag" style="--tc:#7a6e8e">🔁 ' + REPEAT[t.Repeat].name + '</span>';
    meta += '<span class="tag" style="--tc:' + c.color + '">' + c.name + '</span>';
    return '<article class="task' + (t.Done ? ' done' : '') + '" data-id="' + t.Id + '" style="--cc:' + c.color + '">' +
      '<button type="button" class="check" aria-label="' + (t.Done ? 'Mark not done' : 'Mark done') + '"></button>' +
      '<div class="t-body"><div class="t-title">' + esc(t.Title) + '</div>' +
      (t.Notes ? '<div class="t-notes">' + esc(t.Notes.split('\n')[0]) + '</div>' : '') +
      '<div class="t-meta">' + meta + '</div></div>' +
      '<div class="badge" aria-hidden="true">' + c.emoji + '</div></article>';
  }

  function renderWeek() {
    var dow = (view.getDay() + 6) % 7; // Monday first
    var mon = addDays(view, -dow), tk = key(today()), vk = key(view), html = '';
    for (var i = 0; i < 7; i++) {
      var d = addDays(mon, i), k = key(d), list = tasksOn(k);
      var allDone = list.length && list.every(function (t) { return t.Done; });
      html += '<button type="button" class="day' + (k === tk ? ' today' : '') + (k === vk ? ' sel' : '') + '" data-k="' + k + '" aria-label="' + shortDate(d) + '">' +
        '<span class="dw">' + WD[d.getDay()].slice(0, 2) + '</span><span class="dn">' + d.getDate() + '</span>' +
        (list.length ? '<span class="dot' + (allDone ? ' done' : '') + '"></span>' : '') + '</button>';
    }
    $('days').innerHTML = html;
  }

  function renderCats(dayTasks) {
    var counts = {};
    dayTasks.forEach(function (t) { counts[t.Category] = (counts[t.Category] || 0) + 1; });
    var used = CATS.filter(function (c) { return counts[c.key] || c.key === catFilter; });
    var box = $('cats');
    if (used.length < 2 && !catFilter) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var html = '<button type="button" class="pill' + (!catFilter ? ' on' : '') + '" data-c="">🗂️ All</button>';
    used.forEach(function (c) {
      html += '<button type="button" class="pill' + (catFilter === c.key ? ' on' : '') + '" data-c="' + c.key + '" style="--pc:' + c.color + '">' +
        c.emoji + ' ' + c.name + ' <span class="c">' + (counts[c.key] || 0) + '</span></button>';
    });
    box.innerHTML = html;
  }

  function renderAddChips() {
    var c = cat(newCat), p = prio(newPrio);
    $('catChip').innerHTML = '<span class="sw" style="background:' + c.color + '"></span>' + c.emoji + ' ' + c.name;
    $('prioChip').innerHTML = p.emoji + ' ' + p.name;
    $('repChip').textContent = '🔁 ' + (newRepeat ? REPEAT[newRepeat].name : 'Repeat');
    $('repChip').classList.toggle('on', !!newRepeat);
    $('timeLabel').textContent = newTime ? '🕒 ' + timeDisp(newTime) : '🕒 Add time';
    $('newTime').value = newTime;
    $('timeClear').hidden = !newTime;
  }

  // ---------- Actions ----------
  function addTask(e) {
    e.preventDefault();
    var input = $('newTitle'), text = input.value.trim();
    if (!text) { input.focus(); return; }
    input.value = '';
    smartAdd(text, true);            // AI when it's on and reachable, otherwise the built-in parser (dates, priority, several tasks)
    newTime = '';
  }
  // Adds a task (and, when a repeat is chosen, starts its series and creates the coming ones).
  function createTask(title, date, time, rule, prio, cat) {
    var t = normalize({ Title: title, Date: key(date), Time: time, Priority: prio === undefined ? newPrio : prio, Category: cat === undefined ? newCat : cat, Created: nowTicks() });
    if (rule && REPEAT[rule]) startSeries(t, rule);
    tasks.push(t);
    if (t.Series) fillRepeats();
    save();
    return t;
  }
  function friendlyAdd(text, time, date, rule) {
    var when = diffDays(date, today()) === 0 ? '' : ' for ' + friendly(date);
    return 'Added' + when + (time ? ' at ' + timeDisp(time) : '') + (rule ? ' 🔁 ' + REPEAT[rule].say : '') + ' 👍';
  }

  // ---------- Voice ----------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, listening = false;
  var WDN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var LANGS = [['', 'Same as my phone'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar-SA', 'العربية (Arabic)'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['pt-BR', 'Português'], ['tr-TR', 'Türkçe']];
  var LANG = 'dailyjoy.lang';
  function voiceLang() {
    var v = ''; try { v = localStorage.getItem(LANG) || ''; } catch (e) {}
    return v || navigator.language || 'en-US';
  }
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = /^en/i.test(voiceLang()) ? (navigator.language || 'en-US') : 'en-US';
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  // ---- Smarter voice: understands dates, times, durations, priority, category and several tasks in one go ----
  var NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
  var MONRX = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var MONS3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var PRIO_HIGH = /\s(?:(?:this is |it'?s |that'?s )?(?:very |really |super )?(?:urgent|important|high[- ]priority|top[- ]priority)|asap|as soon as possible|a priority|high priority)(?=\s)/i;
  var PRIO_LOW = /\s(?:(?:low|lowest)[- ]priority|not urgent|no rush|whenever(?: i can| you can)?|when i can|when i get a chance)(?=\s)/i;
  var CAT_WORDS = [
    ['health',   /\b(gym|workout|work out|exercise|run|running|jog|yoga|swim|swimming|doctor|dentist|clinic|medicine|medication|pills?|vitamins?|meditat\w*|stretch\w*|walk|physio|therapy|appointment|checkup)\b/i],
    ['shopping', /\b(buy|groceries|grocery|shopping|supermarket|store|market|order|purchase|pick up (?:the )?(?:milk|bread|eggs))\b/i],
    ['learning', /\b(study|homework|assignment|read|reading|course|class|lesson|exam|quiz|test|learn\w*|practice|lecture|revise|revision|tutorial)\b/i],
    ['work',     /\b(meeting|email|e-mail|report|boss|client|office|presentation|deadline|invoice|project|proposal|manager|conference|standup|interview|submit|work)\b/i],
    ['home',     /\b(clean\w*|laundry|dishes|trash|garbage|cook\w*|vacuum|repair|plumber|garden\w*|rent|bills?|wash\w*|tidy|iron\w*|fix|mop|landlord|electrician)\b/i],
    ['fun',      /\b(watch|movie|film|series|episode|netflix|match|party|birthday|dinner|lunch|game|concert|trip|friends?|picnic|cinema|hang out|date night|holiday|vacation|celebrate|barbecue|bbq|coffee with)\b/i]
  ];
  function guessCat(title) {
    for (var i = 0; i < CAT_WORDS.length; i++) if (CAT_WORDS[i][1].test(title)) return CAT_WORDS[i][0];
    return '';
  }
  function dayTime(part) { return { morning: '09:00', afternoon: '14:00', evening: '18:00', tonight: '20:00', night: '21:00' }[part]; }
  function nextDayOfMonth(day) {
    var t = today(), d = new Date(t.getFullYear(), t.getMonth(), day);
    if (d.getDate() !== day || d < t) { d = new Date(t.getFullYear(), t.getMonth() + 1, day); if (d.getDate() !== day) return null; }
    return d;
  }
  // "Gym at 6 pm tomorrow, high priority" ->
  //   { title: "Gym", date: <Date or null>, time: "18:00" or "", priority: 2 or null, category: "health" or "" }
  function parseSpoken(text) {
    var s = ' ' + text.replace(/[,;]/g, ' ').replace(/[.!?]+(?=\s|$)/g, '').replace(/\s+/g, ' ').trim() + ' ';
    var d = null, time = '', priority = null, tonight = false, m;
    // Day numbers said in words, before a month: "twenty december", "at twenty first of december", "the twentieth of december"
    var TENS = { twenty: 20, thirty: 30 }, ORDN = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
    var DAYW = '\\b(?:(twenty|thirty)(?:[\\s-]+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth))?|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth))\\b';
    s = s.replace(new RegExp('(?:\\b(?:at|on|the)\\s+)?' + DAYW + '(?=\\s+(?:of\\s+)?' + MONRX + '(?=\\s))', 'gi'), function (all, t, o, ord) {
      var n = ord ? ORDN[ord.toLowerCase()] : TENS[t.toLowerCase()] + (o ? ORDN[o.toLowerCase()] : 0);
      return ' ' + n + ' ';
    });
    s = s.replace(/\bat\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, function (a, w) { return 'at ' + NUMW[w.toLowerCase()]; });

    // priority words
    if ((m = PRIO_HIGH.exec(s))) { priority = 2; s = s.replace(m[0], ' '); }
    else if ((m = PRIO_LOW.exec(s))) { priority = 0; s = s.replace(m[0], ' '); }

    // "in 20 minutes", "in two hours", "in an hour", "in half an hour", "in 3 days", "in a week"
    var amt = '(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)';
    if ((m = /\sin\s+(?:a\s+)?couple\s+(?:of\s+)?days(?=\s)/i.exec(s))) { d = addDays(today(), 2); s = s.replace(m[0], ' '); }
    else if ((m = /\sin\s+(?:a\s+)?couple\s+(?:of\s+)?(?:weeks)(?=\s)/i.exec(s))) { d = addDays(today(), 14); s = s.replace(m[0], ' '); }
    else if ((m = /\s(?:in\s+(?:a|one)\s+month|next\s+month)(?=\s)/i.exec(s))) { var nm = today(); d = new Date(nm.getFullYear(), nm.getMonth() + 1, nm.getDate()); s = s.replace(m[0], ' '); }
    else if ((m = /\sin\s+(?:about\s+)?half\s+an?\s+hour(?=\s)/i.exec(s))) { time = '+30'; s = s.replace(m[0], ' '); }
    else if ((m = /\sin\s+(?:about\s+)?an?\s+hour\s+and\s+a\s+half(?=\s)/i.exec(s))) { time = '+90'; s = s.replace(m[0], ' '); }
    else if ((m = new RegExp('\\sin\\s+(?:about\\s+)?' + amt + '\\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)(?=\\s)', 'i').exec(s))) {
      var raw = m[1].toLowerCase(), n = /^an?$/.test(raw) ? 1 : (NUMW[raw] || parseFloat(raw)), unit = m[2].toLowerCase()[0];
      if (unit === 'm') time = '+' + Math.round(n);
      else if (unit === 'h') time = '+' + Math.round(n * 60);
      else d = addDays(today(), Math.round(n) * (unit === 'w' ? 7 : 1));
      s = s.replace(m[0], ' ');
    }
    if (/^\+\d+$/.test(time)) {                          // a time counted from now
      var at = new Date(Date.now() + (+time.slice(1)) * 60000);
      d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
      time = pad(at.getHours()) + ':' + pad(at.getMinutes());
    }

    // dates
    if (!d) {
      if ((m = /\s(?:the\s+)?day after tomorrow(?=\s)/i.exec(s))) { d = addDays(today(), 2); s = s.replace(m[0], ' '); }
      else if ((m = /\s(today|tonight|tomorrow)(?=\s)/i.exec(s))) {
        d = addDays(today(), /tomorrow/i.test(m[1]) ? 1 : 0); tonight = /tonight/i.test(m[1]); s = s.replace(m[0], ' ');
      }
      else if ((m = /\s(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:the\s+)?month\s+of\s+/i.exec(s))) { /* unlikely phrase: ignore */ }
      if (!d && (m = new RegExp('\\s(?:on\\s+|at\\s+|by\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONRX + '(?:\\s+(20\\d\\d))?(?=\\s)', 'i').exec(s))) {
        d = dateOf(MONS3.indexOf(m[2].toLowerCase().slice(0, 3)), +m[1], m[3]); if (d) s = s.replace(m[0], ' ');
      }
      if (!d && (m = new RegExp('\\s(?:on\\s+|at\\s+|by\\s+)?' + MONRX + '\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?![:.]?\\d)(?!\\s*(?:a\\.?m|p\\.?m|o\'?clock))(?:\\s+(20\\d\\d))?(?=\\s)', 'i').exec(s))) {
        d = dateOf(MONS3.indexOf(m[1].toLowerCase().slice(0, 3)), +m[2], m[3]); if (d) s = s.replace(m[0], ' ');
      }
      if (!d && (m = /\s(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)(?=\s)/i.exec(s))) {
        d = +m[1] >= 1 && +m[1] <= 31 ? nextDayOfMonth(+m[1]) : null; if (d) s = s.replace(m[0], ' ');
      }
      if (!d && (m = /\s(?:this\s+|on\s+the\s+|on\s+)?weekend(?=\s)/i.exec(s))) {
        d = addDays(today(), (6 - today().getDay() + 7) % 7); s = s.replace(m[0], ' ');
      }
      if (!d && (m = /\snext\s+week(?=\s)/i.exec(s))) { d = addDays(today(), 7); s = s.replace(m[0], ' '); }
      if (!d && (m = /\s(?:on\s+)?(?:this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s)/i.exec(s))) {
        d = addDays(today(), (WDN.indexOf(m[1].toLowerCase()) - today().getDay() + 7) % 7 || 7); s = s.replace(m[0], ' ');
      }
    }

    // times
    if (!time) {
      var h, mi;
      if ((m = /\s(?:at\s+)?noon(?=\s)/i.exec(s))) { time = '12:00'; s = s.replace(m[0], ' '); }
      else if ((m = /\s(?:at\s+)?midnight(?=\s)/i.exec(s))) { time = '00:00'; s = s.replace(m[0], ' '); }
      else if ((m = /\s(?:at\s+)?(half|quarter)\s+(past|to)\s+(\d{1,2})(?=\s)/i.exec(s)) && +m[3] >= 1 && +m[3] <= 12) {
        h = +m[3]; if (h >= 1 && h <= 6 && !/morning/i.test(s)) h += 12;
        mi = /^h/i.test(m[1]) ? 30 : (/^p/i.test(m[2]) ? 15 : 45);
        if (/^t/i.test(m[2])) h -= 1;
        time = pad(h % 24) + ':' + pad(mi); s = s.replace(m[0], ' ');
      }
      else if ((m = /\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:o'?clock\s*)?(?:in the|at|this)\s+(morning|afternoon|evening|night)(?=\s)/i.exec(s)) && +m[1] >= 1 && +m[1] <= 12) {
        h = +m[1]; mi = m[2] ? +m[2] : 0; var part = m[3].toLowerCase();
        if (part === 'morning') { if (h === 12) h = 0; }
        else if (part === 'night') { if (h === 12) h = 0; else if (h >= 6) h += 12; }
        else if (h < 12) h += 12;
        time = pad(h) + ':' + pad(mi); s = s.replace(m[0], ' ');
      }
      else if ((m = /\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(s)) && +m[1] >= 1 && +m[1] <= 12 && (m[2] ? +m[2] : 0) <= 59) {
        h = +m[1]; mi = m[2] ? +m[2] : 0;
        var pm = /^p/i.test(m[3]);
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
        time = pad(h) + ':' + pad(mi); s = s.replace(m[0], ' ');
      }
      else if ((m = /\sat\s+(\d{1,2})(?::(\d{2}))?(?:\s*o'?clock)?(?=\s)(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s)/i.exec(s)) && +m[1] <= 23 && (m[2] ? +m[2] : 0) <= 59) {
        h = +m[1]; mi = m[2] ? +m[2] : 0;
        if (h >= 1 && h <= 6) h += 12;                  // "at 6" usually means the evening
        else if (tonight && h < 12) h += 12;
        time = pad(h) + ':' + pad(mi); s = s.replace(m[0], ' ');
      }
      if (!time && (m = /\s(?:in the\s+|this\s+)?(morning|afternoon|evening|tonight|night)(?=\s)/i.exec(s))) {
        time = dayTime(m[1].toLowerCase()); s = s.replace(m[0], ' ');
        if (/^(tonight|night)$/i.test(m[1]) && !d) d = today();
      }
      if (!time && tonight) time = dayTime('tonight');
    }

    var title = s.replace(/\s+/g, ' ').trim()
      // command words the user says to the app, never part of the task: "add", "create", "add a task to my list"
      .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:add|create|write down|put on my list)\s+(?:a\s+|an\s+|new\s+|another\s+|this\s+)?(?:(?:task|reminder|to-?do|item|note)\s+)?(?:to\s+(?:my|the)\s+(?:list|tasks?)\s+)?(?:(?:to|that|about)\s+)?/i, '')
      .replace(/^(?:please\s+)?(?:(?:remind me|reminder|remember|don'?t forget|i should|i must|i want|i wanna|i gotta|i got to|i'?ll|i will|set (?:a |an )?reminder)(?:\s+(?:to|for|about|that))?|(?:i need|i have|i got)(?:\s+(?:a|an))?(?:\s+(?:to|for|about|that))?)\s+/i, '')
      .replace(/^(?:to|and|then)\s+/i, '')
      .replace(/\s+(at|on|by|for|to|in|and|then|the|this|next)$/i, '').trim();
    if (!title) title = text.trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return { title: title, date: d, time: time, priority: priority, category: guessCat(title) };
  }
  // month index + day -> the next such date (this year, or next year if it already passed)
  function dateOf(month, day, year) {
    if (month < 0 || day < 1 || day > 31) return null;
    var t = today(), d = new Date(year ? +year : t.getFullYear(), month, day);
    if (d.getMonth() !== month) return null;
    if (year) return d;
    if (d < t) d = new Date(t.getFullYear() + 1, month, day);
    return d.getMonth() === month ? d : null;
  }
  function spokenDay(d) {
    var n = diffDays(d, today());
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    return WDL[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
  }
  // One sentence can hold several tasks: "gym at 6pm then call mom tomorrow at noon".
  // A bare "and" only splits when a task verb follows ("gym at 6pm and call mom"), so "salt and pepper" stays one task.
  var SPLIT_RX = /\s+(?:and then|and also|and remind me to|and remember to|and don'?t forget to|then|also|next task|another task|another reminder|new task|new reminder)\s+|\s+and(?=\s+i\s+(?:want|wanna|need|have|should|must|will|gotta|got to|am going|'m going)\b)\s+|\s+and(?=\s+(?:add|create|call|text|message|email|e-mail|buy|get|pick|pay|send|book|check|clean|do|finish|write|read|study|walk|go|meet|take|make|cook|wash|feed|water|renew|cancel|order|submit|remind|remember|visit|fix|print|drop|return|practi[cs]e|review|prepare|plan|schedule|watch|wake|sign|update|upload|brush|shower|stretch|sleep|tidy|vacuum|mop|bring|collect|register|apply|reply|answer|pack)\b)\s+/i;
  function addByVoice(text, typed) {
    text = text.replace(/[“”"«»]/g, '').replace(/\s*[,;]+\s*/g, ' ').replace(/\s+/g, ' ').trim();   // dictation adds commas: "6pm, then, call mom"
    var parts = text.split(SPLIT_RX).map(function (x) { return x.trim(); })
      // a part that is only a command word ("add", "add a task", "create") is not a task
      .filter(function (x) { return x && !/^(?:please\s+)?(?:add|create|new|remind me|reminder)(?:\s+(?:a|an|new|another))?(?:\s+(?:task|reminder|to-?do|item))?$/i.test(x); });
    if (!parts.length) { say('What should I add? Try “Gym at 6pm tomorrow” ✨'); return; }
    var added = [];
    parts.forEach(function (part) {
      var rp = extractRepeat(part), rule = newRepeat, wd = null;
      if (rp) { part = rp.rest; rule = rp.rule; wd = rp.weekday; }
      var p = parseSpoken(part), when = p.date || view, time = p.time || newTime;
      if (wd !== null) when = nextWeekday(today(), wd);
      var prio = p.priority !== null ? p.priority : newPrio;
      var cat = newCat === 'general' && p.category ? p.category : newCat;
      createTask(p.title, when, time, rule, prio, cat);
      added.push({ p: p, when: when, time: time, rule: rule, prio: prio, cat: cat });
    });
    newRepeat = '';
    if (filter === 'done') filter = 'all';
    if (catFilter) catFilter = null;
    render();
    sparkle(typed ? document.querySelector('.add-btn') : $('micBtn'), 14);
    var msg;
    if (added.length === 1) {
      var a = added[0];
      msg = 'Added ' + a.p.title + (a.time ? ' at ' + timeDisp(a.time) : '') + (a.rule ? ', ' + REPEAT[a.rule].say : ', ' + spokenDay(a.when)) + (a.prio === 2 ? ', high priority' : a.prio === 0 && a.p.priority === 0 ? ', low priority' : '') + '.';
    } else {
      msg = 'Added ' + added.length + ' tasks: ' + added.map(function (a) { return a.p.title; }).join(', ') + '.';
    }
    say(msg + ' ✅');
  }
  // ---- Smart add: Claude (through the Worker) turns one sentence into tasks; you confirm them before they are saved ----
  // Falls back to the built-in parser above when it's off, offline, not set up, or anything goes wrong.
  var SMART = 'dailyjoy.smart', smartDown = false, smartBusy = false;
  function smartOn() { return lsGet(SMART) !== '0'; }
  // Open (not done, not repeating) tasks, nearest first: the AI may say "I will pick up mom at 6" and change one of them.
  function openForSmart() {
    return tasks.filter(function (t) { return !t.Done && !t.Series; })
      .sort(function (a, b) { var ka = a.Date + ' ' + (a.Time || '99:99'), kb = b.Date + ' ' + (b.Time || '99:99'); return ka < kb ? -1 : ka > kb ? 1 : 0; })
      .slice(0, 30).map(function (t) { return { id: t.Id, title: t.Title, date: t.Date, time: t.Time, priority: ['low', 'normal', 'high'][t.Priority] || 'normal' }; });
  }
  function smartAdd(text, typed) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!smartOn() || smartDown || !PUSH_SERVER || navigator.onLine === false || text.length < 4 || smartBusy) { addByVoice(text, typed); return; }
    var snap = { cat: newCat, prio: newPrio, time: newTime, rep: newRepeat, day: view };
    var toast = $('toast');
    function fallback(msg) {
      toast.classList.remove('show'); smartBusy = false;
      newCat = snap.cat; newPrio = snap.prio; newTime = snap.time; newRepeat = snap.rep;
      addByVoice(text, typed);
      newTime = '';
      if (msg) setTimeout(function () { say(msg); }, 1800);
    }
    smartBusy = true;
    toast.innerHTML = '<span>✨ Understanding that…</span>'; toast.classList.add('show'); clearTimeout(toastTimer);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    var n = new Date();
    fetch(PUSH_SERVER + '/parse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({
        text: text, code: inboxCode(), open: openForSmart(), now: key(n) + ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes()), weekday: WDL[n.getDay()],
        tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })()
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d }; });
    }).then(function (x) {
      clearTimeout(timer);
      if (x.status === 503) { smartDown = true; fallback(); return; }
      if (x.status === 429) { fallback('Smart add limit reached for today, used the basic parser'); return; }
      var list = x.d && x.d.tasks;
      if (x.status !== 200 || !list || !list.length) { fallback(); return; }
      smartBusy = false; toast.classList.remove('show');
      smartSheet(list, text, typed, snap);
    }).catch(function () { clearTimeout(timer); fallback(); });
  }
  function smartSheet(list, text, typed, snap) {
    var saved = false;
    function isEdit(t) { var o = t.editOf ? find(t.editOf) : null; return !!(o && !o.Series); }
    function isRemove(t) { return isEdit(t) && t.remove === true; }
    function isDone(t) { return isEdit(t) && t.done === true && t.remove !== true; }
    // A delete or "I finished it" that cannot find its task (for example a repeating one) is dropped, never turned into a new task.
    var items = list.filter(function (t) { return !((t.remove === true || t.done === true) && !isEdit(t)); });
    function meta(t) {
      var bits = [];
      var o = isEdit(t) ? find(t.editOf) : null;
      var d = t.date ? parseKey(t.date) : o ? parseKey(o.Date) : snap.day;
      var w = friendly(d); bits.push('📅 ' + w.charAt(0).toUpperCase() + w.slice(1));
      var tm = t.time || snap.time; if (tm) bits.push('🕒 ' + timeDisp(tm));
      var c = t.category !== 'general' ? t.category : snap.cat;
      if (c !== 'general') bits.push(cat(c).emoji + ' ' + cat(c).name);
      var rp = t.repeat || snap.rep; if (rp && REPEAT[rp]) bits.push('🔁 ' + REPEAT[rp].name);
      if (t.priority === 'high') bits.push('🔥 High'); else if (t.priority === 'low') bits.push('🌿 Low');
      else if (o && t.priority === 'normal' && o.Priority !== 1) bits.push('⭐ Normal');   // an edit that moves a task back to normal
      return bits.join('  ·  ');
    }
    function paint() {
      var html = '<h2>✨ Smart add</h2><p class="muted">Here’s what I understood. Tap ✕ to drop one.</p><div class="opts" id="saList">';
      items.forEach(function (t, i) {
        html += '<div class="opt sa-row"><span class="sa-sw" style="background:' + cat(t.category !== 'general' ? t.category : snap.cat).color + '"></span>' +
          '<span class="sa-txt"><b>' + (isRemove(t) ? '🗑️ Delete: ' : isDone(t) ? '✅ Done: ' : isEdit(t) ? '✏️ Update: ' : '') + esc(t.title) + '</b><small>' + esc(isRemove(t) || isDone(t) ? '' : meta(t)) + '</small></span>' +
          '<button type="button" class="sa-x" data-i="' + i + '" aria-label="Remove">✕</button></div>';
      });
      html += '</div><div class="sheet-actions"><button type="button" class="btn soft" id="saCancel">Cancel</button>' +
        '<button type="button" class="btn primary" id="saOk">' + (!items.length ? 'Nothing to add' : items.some(isEdit) ? 'Save' : 'Add ' + (items.length === 1 ? 'task' : items.length + ' tasks')) + '</button></div>';
      return html;
    }
    function wire() {
      var s = $('sheet');
      s.querySelectorAll('.sa-x').forEach(function (b) {
        b.onclick = function () { items.splice(+b.dataset.i, 1); s.innerHTML = '<div class="grab"></div>' + paint(); wire(); };
      });
      $('saCancel').onclick = closeSheet;
      $('saOk').onclick = function () {
        if (!items.length) { closeSheet(); return; }
        saved = true;
        var added = [], updated = [], removed = [], finished = [];
        items.forEach(function (t) {
          var d = t.date ? parseKey(t.date) : snap.day;
          var rule = t.repeat || snap.rep || '';
          var p = t.priority === 'high' ? 2 : t.priority === 'low' ? 0 : snap.prio;
          var c = t.category !== 'general' ? t.category : snap.cat;
          var old = t.editOf ? find(t.editOf) : null;
          if (old && !old.Series) {
            if (t.remove === true) {
              // A delete: remove the existing task (the sentence said cancel/delete).
              tasks = tasks.filter(function (x) { return x.Id !== old.Id; });
              removed.push(old.Title);
              return;
            }
            if (t.done === true) {
              // "I did it": mark the existing task done, like swiping it right.
              old.Done = true;
              finished.push(old.Title);
              return;
            }
            // An edit: change the existing task, keeping whatever the sentence did not mention.
            old.Title = t.title;
            if (t.date) old.Date = t.date;
            if (t.time) old.Time = t.time;
            // The server decides the new priority in code (and repeats the old one when the sentence says nothing), so apply all three levels.
            if (t.priority === 'high') old.Priority = 2; else if (t.priority === 'low') old.Priority = 0; else if (t.priority === 'normal') old.Priority = 1;
            if (t.category !== 'general') old.Category = t.category;
            updated.push(t.title);
            return;
          }
          createTask(t.title, d, t.time || snap.time, rule, p, c);
          added.push(t.title);
        });
        save();
        newRepeat = ''; newTime = '';
        if (filter === 'done') filter = 'all';
        if (catFilter) catFilter = null;
        closeSheet(); render();
        sparkle(typed ? document.querySelector('.add-btn') : $('micBtn'), 14);
        var msg = added.length === 0 ? '' : added.length === 1 ? 'Added ' + added[0] + '.' : 'Added ' + added.length + ' tasks: ' + added.join(', ') + '.';
        if (updated.length) msg += (msg ? ' ' : '') + 'Updated ' + updated.join(', ') + '.';
        if (removed.length) msg += (msg ? ' ' : '') + 'Deleted ' + removed.join(', ') + '.';
        if (finished.length) msg += (msg ? ' ' : '') + 'Marked done: ' + finished.join(', ') + '.';
        say(msg + ' ✅');
      };
    }
    sheetClose = function () { if (!saved && typed) { var inp = $('newTitle'); if (!inp.value) inp.value = text; } };   // cancelled: put the typed sentence back
    openSheet(paint(), wire);
  }
  function setMic(on) {
    var b = $('micBtn');
    b.classList.toggle('listening', on);
    b.setAttribute('aria-label', on ? 'Stop listening' : 'Add by voice');
    b.textContent = on ? '⏹' : '🎤';
  }
  function voiceAdd() {
    if (!SR) { say('Voice isn’t supported in this browser. Use the 🎤 on your keyboard instead.'); return; }
    if (listening) { try { rec.stop(); } catch (e) {} return; }
    var input = $('newTitle'), prev = input.value, heard = '', full = '';
    try { rec = new SR(); } catch (e) { say('Voice isn’t available here 🎙️'); return; }
    rec.lang = voiceLang();
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    // Stop on our own once you go quiet (iPhone keeps listening otherwise):
    // 1.5 s of silence after you've said something, or 7 s if nothing was heard at all.
    var quiet = null;
    function stopSoon(ms) {
      clearTimeout(quiet);
      quiet = setTimeout(function () { try { rec.stop(); } catch (e) {} }, ms);
    }
    rec.onstart = function () { say('Listening… say it like “Gym at 6pm tomorrow” 🎙️'); stopSoon(7000); };
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      full = (heard + interim).trim();
      input.value = full;
      if (full) stopSoon(1500);
    };
    rec.onerror = function (e) {
      if (e.error === 'aborted') return;
      say(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone is blocked. Allow it for Daily Joy in Settings.'
        : e.error === 'no-speech' ? 'Didn’t hear anything. Tap 🎤 and try again.'
        : 'Voice didn’t work this time. Try again 🎙️');
    };
    rec.onend = function () {
      clearTimeout(quiet);
      listening = false; setMic(false);
      if (full) { input.value = ''; smartAdd(full, false); }
      else input.value = prev;
    };
    listening = true; setMic(true);
    try { rec.start(); }
    catch (e) { listening = false; setMic(false); input.value = prev; say('Voice didn’t start. Try again 🎙️'); }
  }

  function toggle(id, el) {
    var t = find(id); if (!t) return;
    t.Done = !t.Done; save();
    if (t.Done) {
      var chk = el && el.querySelector('.check');
      if (chk) { chk.classList.add('bump'); sparkle(chk, 16); }
      if (navigator.vibrate) navigator.vibrate(12);
      var list = tasksOn(t.Date);
      if (list.every(function (x) { return x.Done; })) {
        confetti();
        say('🎉 All done for ' + friendly(parseKey(t.Date)) + '! You’re amazing!');
      } else say(pick(CHEERS));
    }
    setTimeout(render, t.Done ? 220 : 0);
  }

  function find(id) { for (var i = 0; i < tasks.length; i++) if (tasks[i].Id === id) return tasks[i]; return null; }

  // Applies a change and returns a function that reverts it. Shows an Undo toast when given a message.
  function withUndo(message, change) {
    var before = snapshot(), seriesBefore = JSON.parse(JSON.stringify(series));
    change();
    save(); render();
    var undo = function () { tasks = before.map(normalize); series = seriesBefore; save(); render(); say('Undone ↩️'); };
    if (message) say(message, undo);
    return undo;
  }

  function deleteTask(id, wholeSeries) {
    var t = find(id); if (!t) return;
    if (wholeSeries && t.Series) {
      var sid = t.Series, from = t.Date;
      withUndo('Stopped repeating “' + truncate(t.Title, 22) + '”', function () {
        tasks = tasks.filter(function (x) { return x.Series !== sid || x.Date < from; });
        delete series[sid];
      });
      return;
    }
    withUndo('Deleted “' + truncate(t.Title, 22) + '”', function () { tasks = tasks.filter(function (x) { return x.Id !== id; }); });
  }
  function deleteRepeatSheet(id) {
    var html = '<h2>Delete a repeating task</h2><div class="opts">' +
      '<button type="button" class="opt" data-v="one"><span class="oe">🗑️</span>Just this one<span class="os">Keeps the repeat going</span></button>' +
      '<button type="button" class="opt" data-v="all"><span class="oe">🛑</span>This and all future<span class="os">Stops the repeat</span></button></div>';
    openSheet(html, function (s) {
      s.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { closeSheet(); deleteTask(id, b.dataset.v === 'all'); }; });
    });
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function bringOverdue() {
    var tk = key(today()), moved = 0;
    var undo = withUndo('', function () {
      tasks.forEach(function (t) { if (!t.Done && t.Date < tk) { t.Date = tk; moved++; } });
    });
    say('Moved ' + moved + ' to today ☀️', undo);
  }

  function moveUnfinished() {
    var vk = key(view), nk = key(addDays(view, 1));
    var count = tasksOn(vk).filter(function (t) { return !t.Done; }).length;
    if (!count) { say('Nothing unfinished to move 🙌'); return; }
    withUndo('Moved ' + count + ' to ' + friendly(addDays(view, 1)) + ' ➡️', function () {
      tasks.forEach(function (t) { if (t.Date === vk && !t.Done) t.Date = nk; });
    });
  }
  function clearDone() {
    var vk = key(view);
    var count = tasksOn(vk).filter(function (t) { return t.Done; }).length;
    if (!count) { say('No finished tasks to clear'); return; }
    withUndo('Cleared ' + count + ' done task' + (count > 1 ? 's' : '') + ' 🧹', function () {
      tasks = tasks.filter(function (t) { return !(t.Date === vk && t.Done); });
    });
  }

  // Changing day slides the list in from the side you moved towards.
  function setView(d) {
    var moved = key(d) !== key(view), dir = d > view ? 1 : -1;
    view = d; catFilter = null; render();
    if (!moved) return;
    var l = $('list');
    l.classList.remove('slide-r', 'slide-l'); void l.offsetWidth;
    l.classList.add(dir > 0 ? 'slide-r' : 'slide-l');
  }

  // Theme: applyTheme only shows it; setTheme also remembers the user's choice.
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#3a2160' : '#ff6f7d');
    render();
  }
  function savedTheme() {
    try { var t = localStorage.getItem(THEME); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; }
  }
  function setTheme(t) {
    try { localStorage.setItem(THEME, t); } catch (e) {}
    applyTheme(t);
  }
  // With no saved choice the app follows the phone's light/dark setting, live.
  var sysDark = matchMedia('(prefers-color-scheme: dark)');
  function followSystem() { if (!savedTheme()) applyTheme(sysDark.matches ? 'dark' : 'light'); }
  if (sysDark.addEventListener) sysDark.addEventListener('change', followSystem);
  else if (sysDark.addListener) sysDark.addListener(followSystem);

  // ---------- Export / Import ----------
  function exportTasks() {
    var json = JSON.stringify(tasks, null, 2);
    var name = 'daily-joy-tasks-' + key(today()) + '.json';
    var file;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|ipod|android/i.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: 'Daily Joy tasks' }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    say('Exported ' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's') + ' 📦');
  }
  function importTasks(file) {
    var r = new FileReader();
    r.onload = function () {
      var data;
      try {
        var text = String(r.result).replace(/^\uFEFF/, '');
        data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('not a list');
      } catch (e) { say('That file doesn’t look like a task list 🤔'); return; }
      var added = 0, updated = 0, skipped = 0;
      var undo = withUndo('', function () {
        data.forEach(function (raw) {
          if (!raw || typeof raw !== 'object') return;
          var hadId = !!(raw.Id && /^[A-Za-z0-9_-]{1,64}$/.test(String(raw.Id)));
          var t = normalize(raw), cur = find(t.Id);
          // No usable Id (older or hand-made backup): a task with the same title, day and time counts as the same one.
          if (!cur && !hadId) {
            var same = tasks.filter(function (x) { return x.Title === t.Title && x.Date === t.Date && x.Time === t.Time; })[0];
            if (same) { skipped++; return; }
          }
          if (cur) { Object.assign(cur, t); updated++; } else { tasks.push(t); added++; }
        });
      });
      say('Imported: ' + added + ' new, ' + updated + ' updated' + (skipped ? ', ' + skipped + ' already there' : '') + ' 📥', undo);
    };
    r.readAsText(file);
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function say(text, undo) {
    var el = $('toast');
    if (!text) return;
    el.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button">Undo</button>' : '');
    if (undo) el.querySelector('button').onclick = function () { el.classList.remove('show'); undo(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, undo ? 5000 : 2200);
  }

  // ---------- Bottom sheets ----------
  var sheetClose = null;
  function openSheet(html, mount) {
    var s = $('sheet'), b = $('backdrop');
    s.innerHTML = '<div class="grab"></div>' + html;
    s.style.transform = ''; s.style.transition = ''; b.style.opacity = ''; b.style.transition = '';   // clear any drag leftovers
    s.hidden = false; b.hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { s.classList.add('show'); b.classList.add('show'); }); });
    if (mount) mount(s);
  }
  function closeSheet() {
    var s = $('sheet'), b = $('backdrop');
    if (s.hidden) return;
    s.classList.remove('show'); b.classList.remove('show');
    if (document.activeElement && s.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(function () { s.hidden = true; b.hidden = true; s.innerHTML = ''; }, 300);
    if (sheetClose) { var f = sheetClose; sheetClose = null; f(); }
  }

  // Drag the sheet down by its top edge to close it. Only starts when the sheet's content is scrolled to the top,
  // so normal scrolling inside a long sheet still works.
  (function () {
    var s = $('sheet'), b = $('backdrop');
    var y0 = 0, dy = 0, armed = false, drag = false;
    s.addEventListener('touchstart', function (e) {
      armed = e.touches.length === 1 && s.scrollTop <= 0;
      drag = false; dy = 0; y0 = e.touches[0].clientY;
    }, { passive: true });
    s.addEventListener('touchmove', function (e) {
      if (!armed) return;
      var d = e.touches[0].clientY - y0;
      if (!drag) {
        if (Math.abs(d) < 8) return;
        if (d < 0 || s.scrollTop > 0) { armed = false; return; }   // it's a scroll, leave it alone
        drag = true; s.style.transition = 'none'; b.style.transition = 'none';
      }
      e.preventDefault();
      dy = Math.max(0, d);
      s.style.transform = 'translateY(' + dy + 'px)';
      b.style.opacity = String(Math.max(0, 1 - dy / 320));
    }, { passive: false });
    function release() {
      var was = drag;
      armed = false; drag = false;
      if (!was) return;
      s.style.transition = ''; b.style.transition = '';
      if (dy > 110) {
        s.style.transform = 'translateY(105%)'; b.style.opacity = '';
        closeSheet();
      } else {
        s.style.transform = ''; b.style.opacity = '';   // springs back
      }
    }
    s.addEventListener('touchend', release);
    s.addEventListener('touchcancel', release);
  })();

  function catSheet(current, onPick) {
    var html = '<h2>Pick a category</h2><div class="opts">';
    CATS.forEach(function (c) {
      html += '<button type="button" class="opt' + (c.key === current ? ' on' : '') + '" data-v="' + c.key + '">' +
        '<span class="oe">' + c.emoji + '</span>' + c.name + '<span class="os"><span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + c.color + '"></span></span></button>';
    });
    openSheet(html + '</div>', function (s) {
      s.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { onPick(b.dataset.v); closeSheet(); }; });
    });
  }
  function prioSheet(current, onPick) {
    var subs = ['Whenever you get to it', 'The usual', 'Do this first!'];
    var html = '<h2>How important?</h2><div class="opts">';
    PRIOS.forEach(function (p, i) {
      html += '<button type="button" class="opt' + (i === current ? ' on' : '') + '" data-v="' + i + '"><span class="oe">' + p.emoji + '</span>' + p.name + '<span class="os">' + subs[i] + '</span></button>';
    });
    openSheet(html + '</div>', function (s) {
      s.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { onPick(+b.dataset.v); closeSheet(); }; });
    });
  }

  function repeatSheet(current, onPick) {
    var html = '<h2>Repeat</h2><div class="opts"><button type="button" class="opt' + (!current ? ' on' : '') + '" data-v=""><span class="oe">1️⃣</span>Never<span class="os">Just once</span></button>';
    var emo = { daily: '📆', weekdays: '💼', weekly: '🗓️', monthly: '🌙' };
    REPEAT_KEYS.forEach(function (k) {
      html += '<button type="button" class="opt' + (k === current ? ' on' : '') + '" data-v="' + k + '"><span class="oe">' + emo[k] + '</span>' + REPEAT[k].name + '<span class="os">' + REPEAT[k].sub + '</span></button>';
    });
    openSheet(html + '</div><p class="muted">Tip: you can also just type or say “Gym every Monday at 6pm”.</p>', function (s) {
      s.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { onPick(b.dataset.v); closeSheet(); }; });
    });
  }

  // A name is plain text: no tags, no control characters, at most 30 letters.
  function cleanName(v) { return String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30); }

  // First-run welcome: asks for a name, then a short tour. Shown once; "Welcome tour" in Options shows it again.
  var WELCOMED = 'dailyjoy.welcomed';
  var TOUR = [
    ['✨', 'Add tasks in seconds', 'Type in the box, or tap 🎤 and say it. Try <i>“Gym at 6pm tomorrow”</i>. Dates and times are understood, and one sentence can hold several tasks: <i>“gym and call mom”</i>.'],
    ['👆', 'Swipe and tap', 'Swipe a task <b>right</b> to finish it ✅ and <b>left</b> to move it to tomorrow. Tap a task to change its time, notes, repeat or category.'],
    ['⏰', 'Reminders', 'Give a task a time and Daily Joy rings when it’s due. Turn on <b>Alerts when closed</b> in ••• Options so reminders still arrive with the app closed. <b>🔔 Keep reminding</b> (needs a time) repeats the alert until you finish.'],
    ['🧭', 'Explore the rest', 'Tap <b>•••</b> for Options: morning briefing, evening wrap-up, weekly recap, Siri, voice language and backups. You can see this tour again from Options.']
  ];
  // Can the tour turn on "Alerts when closed" right now? (installed app, server set up, not already on, not refused)
  function canAskPush() {
    try {
      if (pushOn || !pushReady() || !('PushManager' in window) || !('Notification' in window)) return false;
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
      if (ios && !standalone) return false;
      return Notification.permission !== 'denied';
    } catch (e) { return false; }
  }
  var REMIND_STEP = 3;   // the "Reminders" page of the tour (page 0 is the name)
  function welcomeSheet() {
    var step = 0, cur = myName();
    try { localStorage.setItem(WELCOMED, '1'); } catch (e) {}
    function paint(s) {
      var dots = '<div class="wdots" aria-hidden="true">' + Array.apply(null, Array(TOUR.length + 1)).map(function (x, i) {
        return '<i' + (i === step ? ' class="on"' : '') + '></i>';
      }).join('') + '</div>';
      var last = step === TOUR.length, body, buttons;
      if (step === 0) {
        body = '<h2>👋 Welcome to Daily Joy!</h2><p class="muted">Let’s make your days a little brighter. What should I call you?</p>' +
          '<input class="field" type="text" id="wName" maxlength="30" autocomplete="given-name" placeholder="Your name" value="' + esc(cur) + '" aria-label="Your name">';
        buttons = '<button type="button" class="btn ghost" id="wSkip">Skip</button><button type="button" class="btn primary" id="wNext">Next</button>';
      } else {
        var t = TOUR[step - 1], txt = t[2];
        if (step === REMIND_STEP) {
          if (pushOn) txt = 'Give a task a time and Daily Joy rings when it’s due. <b>Alerts when closed</b> is already on ✅, so reminders arrive even with the app closed. <b>🔔 Keep reminding</b> (needs a time) repeats the alert until you finish.';
          else if (canAskPush()) txt = 'Give a task a time and Daily Joy rings when it’s due. When you tap <b>Next</b>, your iPhone asks to send notifications: tap <b>Allow</b> so reminders still arrive with the app closed. <b>🔔 Keep reminding</b> (needs a time) repeats the alert until you finish.';
        }
        body = '<div class="wcard"><div class="wemoji" aria-hidden="true">' + t[0] + '</div><h2>' + t[1] + '</h2><p>' + txt + '</p></div>';
        buttons = '<button type="button" class="btn soft" id="wBack">Back</button><button type="button" class="btn primary" id="wNext">' + (last ? 'Let’s go 🎉' : 'Next') + '</button>';
      }
      s.innerHTML = '<div class="grab"></div>' + dots + body + '<div class="sheet-actions">' + buttons + '</div>';
      $('wNext').onclick = function () {
        if (step === 0) {
          var v = cleanName($('wName').value);
          if (v) { try { localStorage.setItem(NAME, v); } catch (e) {} render(); }
          step = 1; paint(s); return;
        }
        if (last) { closeSheet(); say((myName() ? 'You’re all set, ' + myName() : 'You’re all set') + '! 🎉'); render(); return; }
        // Reminders page: turn on "Alerts when closed" right here. It must happen inside this tap,
        // because iPhone only shows the "Allow notifications" question from a tap.
        if (step === REMIND_STEP && canAskPush()) enablePush();
        step++; paint(s);
      };
      if (step === 0) {
        $('wSkip').onclick = function () { closeSheet(); };
        $('wName').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('wNext').onclick(); } };
      } else {
        $('wBack').onclick = function () { step--; paint(s); };
      }
    }
    openSheet('', paint);
  }

  // Options > Your name: shown in the greeting ("Good morning, Asser"). Saved only on this phone.
  function nameSheet() {
    var html = '<h2>👋 Your name</h2>' +
      '<p class="muted">Shown on the home screen, like “Good morning, Asser”. Leave it empty to hide it.</p>' +
      '<input class="field" type="text" id="nameIn" maxlength="30" autocomplete="given-name" placeholder="Your name" value="' + esc(myName()) + '" aria-label="Your name">' +
      '<div class="sheet-actions"><button type="button" class="btn soft" id="nameCancel">Cancel</button>' +
      '<button type="button" class="btn primary" id="nameSave">Save</button></div>';
    openSheet(html, function (s) {
      var inp = $('nameIn');
      function save() {
        var v = inp.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
        try { if (v) localStorage.setItem(NAME, v); else localStorage.removeItem(NAME); } catch (e) {}
        closeSheet();
        say(v ? 'Hi, ' + v + '! 👋' : 'Name removed');
        render();
      }
      $('nameSave').onclick = save;
      $('nameCancel').onclick = closeSheet;
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } };
      setTimeout(function () { inp.focus(); }, 350);
    });
  }

  function langSheet() {
    var cur = ''; try { cur = localStorage.getItem(LANG) || ''; } catch (e) {}
    var html = '<h2>Voice language</h2><div class="opts">';
    LANGS.forEach(function (l) {
      html += '<button type="button" class="opt' + (l[0] === cur ? ' on' : '') + '" data-v="' + l[0] + '"><span class="oe">🎙️</span>' + l[1] + '</button>';
    });
    openSheet(html + '</div><p class="muted">The words you say are typed in this language. Dates, times and “urgent” are understood in English only.</p>', function (s) {
      s.querySelectorAll('.opt').forEach(function (b) {
        b.onclick = function () {
          try { localStorage.setItem(LANG, b.dataset.v); } catch (e) {}
          closeSheet(); say('Voice language set 🎙️');
        };
      });
    });
  }
  // ---------- Alerts when the app is closed ----------
  function b64uBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pushReady() { return !!PUSH_SERVER && !!VAPID_PUBLIC; }
  // Undone timed tasks for the next 7 days, sent to the server so it can ping this phone when one is due.
  function upcomingReminders() {
    var now = Date.now(), limit = now + 7 * 864e5, out = [];
    tasks.forEach(function (t) {
      if (t.Done || !t.Time || !t.Date || !t.Title) return;
      var d = t.Date.split('-'), hm = t.Time.split(':');
      var at = new Date(+d[0], +d[1] - 1, +d[2], +hm[0], +hm[1]).getTime();
      if (isNaN(at) || at < now - 120000 || at > limit) return;   // skip times that have already passed
      out.push({ k: t.Id + '|' + t.Date + '|' + t.Time, title: t.Title, time: t.Time, at: new Date(at).toISOString() });
    });
    return out.concat(extraReminders(now)).slice(0, 100);
  }
  function syncPush() {
    if (!pushOn || !pushReady() || !('serviceWorker' in navigator)) return Promise.resolve();
    pushLast = Date.now();
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) { pushOn = false; try { localStorage.setItem(PUSHON, '0'); } catch (e) {} return; }
        return fetch(PUSH_SERVER + '/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: { endpoint: sub.endpoint }, reminders: upcomingReminders() })
        });
      }).catch(function () {});
  }
  function queuePush() {
    if (!pushOn) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncPush, 1500);
  }
  // Must be called straight from a tap: iPhone only asks for notification permission inside a tap.
  function enablePush() {
    if (!pushReady()) { say('Alerts are not set up yet'); return; }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!('PushManager' in window) || !('Notification' in window) || (ios && !standalone)) {
      say('On iPhone, add Daily Joy to the Home Screen first 📲'); return;
    }
    var asked = Notification.requestPermission();
    Promise.resolve(asked).then(function (p) {
      if (p !== 'granted') { say('Alerts not allowed. Allow them in Settings > Notifications 🔕'); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) {
          return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(VAPID_PUBLIC) });
        });
      }).then(function () {
        pushOn = true; try { localStorage.setItem(PUSHON, '1'); } catch (e) {}
        return syncPush();
      }).then(function () { say('Alerts on 🔔 You will get reminders even when the app is closed'); });
    }).catch(function () { say('Could not turn alerts on 😢'); });
  }
  function disablePush() {
    pushOn = false; try { localStorage.setItem(PUSHON, '0'); } catch (e) {}
    say('Alerts off 🔕');
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () {
        if (pushReady()) return fetch(PUSH_SERVER + '/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: ep })
        });
      });
    }).catch(function () {});
  }

  function menuSheet() {
    var dark = document.documentElement.dataset.theme === 'dark';
    var items = [
      ['today', '☀️', 'Jump to today', ''],
      ['move', '➡️', 'Move unfinished to tomorrow', ''],
      ['clear', '🧹', 'Clear done tasks', ''],
      ['alarm', alarmOn ? '🔔' : '🔕', 'In-app alarm', alarmOn ? 'On' : 'Off'],
      ['push', pushOn ? '🔔' : '🔕', 'Alerts when closed', pushOn ? 'On' : 'Off'],
      ['brief', '☀️', 'Morning briefing', lsGet(BRIEF) ? timeDisp(lsGet(BRIEF)) : 'Off'],
      ['wrap', '🌙', 'Evening wrap-up', lsGet(WRAP) ? timeDisp(lsGet(WRAP)) : 'Off'],
      ['recap', '📊', 'Weekly recap', 'See your week'],
      ['smart', '✨', 'Smart add (AI)', smartOn() ? 'On' : 'Off'],
      ['siri', '🗣️', 'Hey Siri, add a task', 'Set up'],
      ['testsound', '🔊', 'Test alarm sound', 'Plays a chime'],
      ['name', '👋', 'Your name', myName() || 'Not set'],
      ['tour', '🧭', 'Welcome tour', 'See the basics'],
      ['lang', '🎙️', 'Voice language',(LANGS.filter(function (l) { return l[0] === (function () { try { return localStorage.getItem(LANG) || ''; } catch (e) { return ''; } })(); })[0] || LANGS[0])[1]],
      ['theme', dark ? '☀️' : '🌙', dark ? 'Light theme' : 'Dark theme', ''],
      ['auto', '🌗', 'Match phone theme', savedTheme() ? 'Off' : 'On'],
      ['export', '📦', 'Export tasks', 'Save a .json backup'],
      ['import', '📥', 'Import tasks', 'From a backup or the PC app']
    ];
    var html = '<h2>Options</h2><div class="opts">';
    items.forEach(function (it) {
      html += '<button type="button" class="opt" data-a="' + it[0] + '"><span class="oe">' + it[1] + '</span><span class="ol">' + it[2] + '</span><span class="os">' + it[3] + '</span></button>';
    });
    html += '</div><p class="muted">Smart add sends only the sentence you typed or said to the Daily Joy server, which turns it into tasks. Turn it off to use the built-in parser only. Your tasks are saved on this device only. Use Export and Import to move them to another phone or to the Daily Joy PC app (its file is <b>%APPDATA%\\DailyTasks\\tasks.json</b>).</p>';
    openSheet(html, function (s) {
      s.querySelectorAll('.opt').forEach(function (b) {
        b.onclick = function () {
          var a = b.dataset.a;
          if (a === 'import') { $('importFile').click(); closeSheet(); return; } // click must happen inside the tap
          if (a === 'push') { if (pushOn) disablePush(); else enablePush(); closeSheet(); return; } // permission prompt must be inside the tap
          if (a === 'testsound') {
            unlockAudio.skipDance = true; unlockAudio(); unlockAudio.skipDance = false;
            // we're inside a tap, so play for real right away; that also unlocks the element
            if (webMode) { chime(); } else if (chimeEl) { useChime(); chimeEl.muted = false; chimeReady = true; chimeEl.currentTime = 0; var pp = chimeEl.play(); if (pp && pp.catch) pp.catch(webChime); } else webChime();
            say('v26l · ' + (webMode ? 'web audio' : (navigator.audioSession ? 'player (no WebAudio)' : 'player, no audioSession')) + ' · if silent, turn the volume up 🔊'); closeSheet(); return; }
          closeSheet();
          setTimeout(function () {
            if (a === 'today') setView(today());
            else if (a === 'move') moveUnfinished();
            else if (a === 'clear') clearDone();
            else if (a === 'alarm') {
              alarmOn = !alarmOn;
              try { localStorage.setItem(ALARM, alarmOn ? '1' : '0'); } catch (e) {}
              unlockAudio();
              say(alarmOn ? 'In-app alarm on 🔔' : 'In-app alarm off 🔕');
              if (alarmOn) checkAlarms();
            }
            else if (a === 'theme') setTheme(dark ? 'light' : 'dark');
            else if (a === 'auto') { try { localStorage.removeItem(THEME); } catch (e) {} applyTheme(sysDark.matches ? 'dark' : 'light'); }
            else if (a === 'export') exportTasks();
            else if (a === 'lang') langSheet();
            else if (a === 'name') nameSheet();
            else if (a === 'tour') welcomeSheet();
            else if (a === 'brief' || a === 'wrap') timeSheet(a);
            else if (a === 'recap') recapSheet();
            else if (a === 'siri') siriSheet();
            else if (a === 'smart') {
              lsSet(SMART, smartOn() ? '0' : '1'); smartDown = false;
              say(smartOn() ? 'Smart add on ✨ (AI understands whole sentences)' : 'Smart add off · using the built-in parser');
            }
          }, 350);
        };
      });
    });
  }

  // After an edit: keep the series recipe and the not-yet-done future ones in step with this task.
  function applyRepeatEdit(t, rule) {
    var sid = t.Series, s = sid && series[sid];
    function dropFuture() { tasks = tasks.filter(function (x) { return x === t || x.Series !== sid || x.Done || x.Date <= t.Date; }); }
    if (sid && !rule) {                       // repeat turned off: this stays as a one-off
      dropFuture(); delete series[sid]; t.Series = ''; t.Repeat = ''; return;
    }
    if (!sid && rule) { startSeries(t, rule); fillRepeats(); return; }   // new repeat
    if (!sid) return;
    if (!s) s = series[sid] = { Rule: rule, Anchor: t.Date, Through: t.Date };
    var ruleChanged = rule !== s.Rule;
    s.Title = t.Title; s.Notes = t.Notes; s.Time = t.Time; s.Priority = t.Priority; s.Category = t.Category; s.Nag = t.Nag;
    if (ruleChanged) {                        // new pattern: rebuild everything after this one
      dropFuture(); s.Rule = rule; s.Anchor = t.Date; s.Through = t.Date; t.Repeat = rule;
    } else {                                  // same pattern: refresh the future ones
      tasks.forEach(function (x) {
        if (x !== t && x.Series === sid && !x.Done && x.Date > t.Date) {
          x.Title = t.Title; x.Notes = t.Notes; x.Time = t.Time; x.Priority = t.Priority; x.Category = t.Category; x.Nag = t.Nag;
        }
      });
    }
    fillRepeats();
  }

  function editSheet(id) {
    var t = find(id); if (!t) return;
    var d = { Date: t.Date, Time: t.Time, Priority: t.Priority, Category: t.Category, Repeat: t.Repeat, Top: t.Top, Nag: t.Nag };
    var tk = key(today()), tmk = key(addDays(today(), 1));
    var html = '<h2>Edit task</h2>' +
      '<input class="field" id="eTitle" maxlength="200" value="' + esc(t.Title) + '" aria-label="Title">' +
      '<h3>When</h3><div class="seg" id="eWhen">' +
        '<button type="button" data-v="' + tk + '">☀️ Today</button>' +
        '<button type="button" data-v="' + tmk + '">🌅 Tomorrow</button></div>' +
      '<div class="seg step" id="eStep" style="margin-top:8px">' +
        '<button type="button" id="ePrev">‹ Previous day</button>' +
        '<button type="button" id="eNext">Next day ›</button></div>' +
      '<div class="row" style="margin-top:8px"><input class="field" type="date" id="eDate" aria-label="Date">' +
        '<input class="field" type="time" id="eTime" aria-label="Time"></div>' +
      '<div class="row" style="margin-top:6px"><span class="muted" id="eTimeTxt"></span>' +
        '<button type="button" class="btn ghost small" id="eNoTime" style="flex:0 0 auto">No time</button></div>' +
      '<button type="button" class="btn soft cal-btn" id="eCal">📅 Add alert to iPhone Calendar</button>' +
      '<h3>🔁 Repeat</h3><div class="seg wrap" id="eRep">' +
        '<button type="button" data-v="">Never</button>' +
        REPEAT_KEYS.map(function (k) { return '<button type="button" data-v="' + k + '">' + REPEAT[k].name + '</button>'; }).join('') + '</div>' +
      (t.Series ? '<p class="muted" id="eRepNote">Changes to the title, time, priority or category also apply to the next ones. Moving the date only moves this one.</p>' : '') +
      '<h3>Priority</h3><div class="seg" id="ePrio">' +
        PRIOS.map(function (p, i) { return '<button type="button" data-v="' + i + '" style="--sc:' + p.color + '">' + p.emoji + ' ' + p.name + '</button>'; }).join('') + '</div>' +
      '<h3>Extras</h3><div class="seg" id="eFlags">' +
        '<button type="button" data-v="Top">📌 Top 3 today</button>' +
        '<button type="button" data-v="Nag">🔔 Keep reminding</button></div>' +
      '<p class="muted">Top 3 pins it above everything else. Keep reminding repeats the alert every few minutes until it is done (High priority always does).</p>' +
      '<h3>Category</h3><div class="seg" id="eCat">' +
        CATS.map(function (c) { return '<button type="button" data-v="' + c.key + '" style="--sc:' + c.color + '">' + c.emoji + ' ' + c.name + '</button>'; }).join('') + '</div>' +
      '<h3>Notes</h3><textarea class="field" id="eNotes" placeholder="Anything to remember?">' + esc(t.Notes) + '</textarea>' +
      '<div class="sheet-actions"><button type="button" class="btn danger" id="eDel" aria-label="Delete">🗑️</button>' +
        '<button type="button" class="btn soft" id="eCancel">Cancel</button>' +
        '<button type="button" class="btn primary" id="eSave">Save</button></div>';
    openSheet(html, function (s) {
      function sync() {
        s.querySelectorAll('#eWhen button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === d.Date); });
        s.querySelectorAll('#ePrio button').forEach(function (b) { b.classList.toggle('on', +b.dataset.v === d.Priority); });
        s.querySelectorAll('#eCat button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === d.Category); });
        s.querySelectorAll('#eRep button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === d.Repeat); });
        s.querySelectorAll('#eFlags button').forEach(function (b) { b.classList.toggle('on', !!d[b.dataset.v]); });
        $('eDate').value = d.Date; $('eTime').value = d.Time;
        $('eTimeTxt').textContent = d.Time ? '🕒 ' + timeDisp(d.Time) + ' · ' + friendly(parseKey(d.Date)) : 'No time set · ' + friendly(parseKey(d.Date));
        $('eNoTime').hidden = !d.Time;
        $('eCal').hidden = !d.Time;
      }
      s.querySelectorAll('#eWhen button').forEach(function (b) { b.onclick = function () { d.Date = b.dataset.v; sync(); }; });
      s.querySelectorAll('#ePrio button').forEach(function (b) { b.onclick = function () { d.Priority = +b.dataset.v; sync(); }; });
      s.querySelectorAll('#eCat button').forEach(function (b) { b.onclick = function () { d.Category = b.dataset.v; sync(); }; });
      s.querySelectorAll('#eRep button').forEach(function (b) { b.onclick = function () { d.Repeat = b.dataset.v; sync(); }; });
      s.querySelectorAll('#eFlags button').forEach(function (b) { b.onclick = function () { d[b.dataset.v] = !d[b.dataset.v]; sync(); }; });
      $('ePrev').onclick = function () { d.Date = key(addDays(parseKey(d.Date), -1)); sync(); };
      $('eNext').onclick = function () { d.Date = key(addDays(parseKey(d.Date), 1)); sync(); };
      $('eDate').onchange = function () { if (this.value) d.Date = this.value; sync(); };
      $('eTime').onchange = function () { d.Time = this.value || ''; sync(); };
      $('eNoTime').onclick = function () { d.Time = ''; sync(); };
      $('eCal').onclick = function () {
        if (!d.Time) return;
        addToCalendar({ Id: t.Id, Title: $('eTitle').value.trim() || t.Title, Notes: $('eNotes').value.trim(), Date: d.Date, Time: d.Time });
      };
      $('eCancel').onclick = closeSheet;
      $('eDel').onclick = function () {
        closeSheet();
        setTimeout(function () { if (t.Series) deleteRepeatSheet(id); else deleteTask(id); }, t.Series ? 350 : 150);
      };
      $('eSave').onclick = function () {
        var title = $('eTitle').value.trim();
        if (!title) { $('eTitle').focus(); return; }
        var moved = d.Date !== t.Date;
        t.Title = title; t.Notes = $('eNotes').value.replace(/\s+$/, '');
        t.Date = d.Date; t.Time = d.Time; t.Priority = d.Priority; t.Category = d.Category;
        t.Nag = !!d.Nag; t.Top = !!d.Top;
        var topMsg = '';
        if (t.Top) {   // only three can be pinned per day
          var pinned = tasksOn(t.Date).filter(function (x) { return x !== t && x.Top && !x.Done; });
          if (pinned.length >= 3) { t.Top = false; topMsg = ' (Top 3 is full for that day)'; }
        }
        applyRepeatEdit(t, d.Repeat);
        save(); closeSheet(); render();
        say((moved ? 'Moved to ' + friendly(parseKey(d.Date)) + ' 📅' : 'Saved ✅') + topMsg);
      };
      sync();
    });
  }

  // ---------- Calendar reminder (.ics with alerts) ----------
  // iOS shows these as real notifications even when this app is closed.
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsStamp(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  }
  function buildIcs(t) {
    var p = t.Time.split(':'), start = parseKey(t.Date);
    start.setHours(+p[0], +p[1], 0, 0);
    var end = new Date(start.getTime() + 30 * 60000), now = new Date();
    var z = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var title = icsText(t.Title);
    function alarm(trigger, text) { // text is already escaped
      return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + text, 'TRIGGER:' + trigger, 'END:VALARM'];
    }
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily Joy//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + t.Id + '-' + icsStamp(start) + '@dailyjoy', 'DTSTAMP:' + z,
      'DTSTART:' + icsStamp(start), 'DTEND:' + icsStamp(end), 'SUMMARY:⏰ ' + title];
    if (t.Notes) lines.push('DESCRIPTION:' + icsText(t.Notes));
    lines = lines.concat(alarm('-PT10M', title + ' (in 10 minutes)'), alarm('PT0S', title + ' (now!)'), ['END:VEVENT', 'END:VCALENDAR']);
    return lines.join('\r\n') + '\r\n';
  }
  function addToCalendar(t) {
    var ics = buildIcs(t);
    var name = (t.Title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 30) || 'reminder') + '.ics';
    var file = null;
    try { file = new File([ics], name, { type: 'text/calendar' }); } catch (e) {}
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    // Home Screen app on iPhone: the file would only open in a basic viewer, so hand off to real Safari
    // with cal.html (a new window leaves the app, and Safari shows the "Add to Calendar" screen).
    if (ios && standalone) {
      var a = document.createElement('a');
      a.href = 'cal.html#d=' + encodeURIComponent(ics);
      a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      say('Opening Safari to add it 📅');
      return;
    }
    // iPhone Safari: open a real web address that serves the calendar file (the service worker answers it).
    if (ios && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      var w = null;
      try { w = window.open('reminder.ics?d=' + encodeURIComponent(ics), '_blank'); } catch (e) {}
      if (w) return;
    }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|ipod|android/i.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: t.Title }).catch(function () {});
      return;
    }
    var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    say('Calendar file ready 📅');
  }

  // ---------- In-app alarm (works while Daily Joy is open) ----------
  var ALARM = 'dailyjoy.alarm', FIRED = 'dailyjoy.fired';
  var alarmOn = (function () { try { return localStorage.getItem(ALARM) !== '0'; } catch (e) { return true; } })();
  var fired = (function () { try { return JSON.parse(localStorage.getItem(FIRED) || '{}'); } catch (e) { return {}; } })();
  var snoozed = {}, alarmShowing = null, chimeTimer = null, audio = null, needSound = false;

  function saveFired() {
    var cutoff = Date.now() - 3 * 86400000;
    Object.keys(fired).forEach(function (k) { if (fired[k] < cutoff) delete fired[k]; });
    try { localStorage.setItem(FIRED, JSON.stringify(fired)); } catch (e) {}
  }
  // The chime is a small generated WAV played through a normal <audio> element. On iPhone that plays
  // through the media channel (works with the silent switch on), unlike Web Audio, which gets muted.
  var chimeEl = null, chimeReady = false;
  function makeChimeUrl() {
    var rate = 22050, secs = 1.5, n = Math.floor(rate * secs), notes = [880, 1108.7, 1318.5, 1760];
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var t = i / rate, s = 0;
      notes.forEach(function (f, k) {
        var lt = t - k * 0.16;
        if (lt < 0) return;
        var env = Math.min(1, lt / 0.015) * Math.exp(-lt * 5);
        s += Math.sin(2 * Math.PI * f * lt) * env;
      });
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * 0.45)) * 32767, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  // iOS only lets a page make sound after a tap, so unlock audio on the first touch.
  var chimeUrl = null, silentUrl = null, unlocking = false;
  function makeSilentUrl() {
    var rate = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);   // 0.1 s of silence
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  // Make sure the element holds the real chime (the unlock step swaps in silence for a moment).
  function useChime() { if (chimeEl && chimeUrl && chimeEl.src !== chimeUrl) { chimeEl.src = chimeUrl; } }
  // After the sound is over, empty the element so iOS removes the "Now Playing" card from the lock screen.
  // (The element stays "unlocked", so the next alarm can still play it.)
  var releaseTimer = null;
  // iOS 17+ lets a page choose how its audio behaves; with 'playback' Web Audio plays even with the silent switch on.
  var webMode = (function () { try { return !!(navigator.audioSession && (window.AudioContext || window.webkitAudioContext)); } catch (e) { return false; } })();
  function releaseChime() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      if (!chimeEl || !chimeEl.paused) return;
      try { chimeEl.removeAttribute('src'); chimeEl.load(); } catch (e) {}
      try { if (navigator.mediaSession) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch (e) {}
    }, 400);
  }
  function rewind() { try { chimeEl.currentTime = 0; } catch (e) {} }
  function newChimeEl() {
    chimeUrl = makeChimeUrl(); chimeEl = new Audio(chimeUrl); chimeEl.preload = 'auto';
    chimeEl.addEventListener('ended', releaseChime);
    chimeEl.addEventListener('pause', releaseChime);
  }
  function unlockAudio() {
    if (!webMode) { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {} }
    if (webMode) {
      // Web Audio only: no <audio> element, so iOS shows no "Now Playing" card on the lock screen.
      try {
        var AC0 = window.AudioContext || window.webkitAudioContext;
        if (AC0) {
          if (!audio) audio = new AC0();
          if (audio.state !== 'running') {
            audio.resume().then(function () {
              if (needSound && alarmShowing && audio.state === 'running') {
                needSound = false; var h0 = document.getElementById('alarmHint'); if (h0) h0.hidden = true; webChime();
              }
            }, function () {});
          } else if (needSound && alarmShowing) {
            needSound = false; var h1 = document.getElementById('alarmHint'); if (h1) h1.hidden = true; webChime();
          }
        }
      } catch (e) {}
      return;
    }
    try {
      if (!chimeEl) newChimeEl();
      if (needSound && alarmShowing && !unlockAudio.skipDance) {
        // The app was opened by tapping a notification, so no touch happened yet and the alarm was silent.
        // Play the REAL chime right here, inside the touch itself (iOS only allows sound from a touch).
        useChime(); chimeEl.muted = false;
        rewind();
        // Mark as ready at once so the touch's other events (touchend, click) don't swap in the silent clip mid-chime.
        needSound = false; chimeReady = true; unlocking = false;
        var h = document.getElementById('alarmHint'); if (h) h.hidden = true;
        var rp = chimeEl.play();
        if (rp && rp.catch) rp.catch(function () { chimeReady = false; if (alarmShowing) needSound = true; });
      } else if (!chimeReady && !unlocking && !unlockAudio.skipDance) {
        // Unlock the element by playing SILENCE (not the chime), so nothing audible can leak out.
        unlocking = true;
        if (!silentUrl) silentUrl = makeSilentUrl();
        chimeEl.src = silentUrl;
        var finish = function (ok) {
          unlocking = false;
          if (ok) chimeReady = true;
          if (chimeEl.src === silentUrl) { chimeEl.pause(); chimeEl.src = chimeUrl; releaseChime(); }
          // The app was opened from a notification: no tap happened yet, so the alarm was silent. Ring now.
          if (ok && needSound) { needSound = false; var h = document.getElementById('alarmHint'); if (h) h.hidden = true; if (alarmShowing) chime(); }
        };
        var pr = chimeEl.play();
        if (pr && pr.then) pr.then(function () { finish(true); }, function () { finish(false); }); else finish(true);
      }
    } catch (e) { unlocking = false; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!audio) audio = new AC();
        if (audio.state !== 'running') audio.resume();
      }
    } catch (e) {}
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, unlockAudio, { passive: true }); });

  function chime() {
    if (webMode) {
      try {
        if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'running') webChime();
        else audio.resume().then(function () { if (audio.state === 'running') webChime(); }, function () {});
      } catch (e) {}
      return;
    }
    if (!chimeEl) { try { newChimeEl(); } catch (e) {} }
    clearTimeout(releaseTimer);
    if (chimeEl && chimeReady) {
      try { useChime(); chimeEl.muted = false; rewind(); var p = chimeEl.play(); if (p && p.catch) p.catch(webChime); return; } catch (e) {}
    }
    // Not unlocked yet (e.g. opened from a notification): still try the real chime, then the backup beep.
    try { if (chimeEl) { useChime(); chimeEl.muted = false; rewind(); var p2 = chimeEl.play(); if (p2 && p2.catch) p2.catch(webChime); return; } } catch (e) {}
    webChime();
  }
  function webChime() {
    if (!audio || audio.state !== 'running') return;
    if (webMode) {
      // "playback" only while the chime sounds (so it rings with the silent switch on), then back to normal
      // so iOS drops the lock-screen media card.
      try { navigator.audioSession.type = 'playback'; } catch (e) {}
      clearTimeout(webChime.t);
      webChime.t = setTimeout(function () { try { navigator.audioSession.type = 'auto'; } catch (e) {} }, 1700);
      // Pause the audio engine once the chime is done, so iOS can drop the lock-screen card.
      // The next chime (or a tap) resumes it.
      clearTimeout(webChime.s);
      webChime.s = setTimeout(function () { try { if (audio && audio.state === 'running') audio.suspend(); } catch (e) {} }, 1800);
    }
    var notes = [880, 1108.7, 1318.5, 1760], t0 = audio.currentTime + 0.02;
    notes.forEach(function (f, i) {
      var o = audio.createOscillator(), g = audio.createGain(), st = t0 + i * 0.16;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.35, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.7);
      o.connect(g); g.connect(audio.destination); o.start(st); o.stop(st + 0.75);
    });
  }
  function ringAlarm() {
    chime();
    var act = navigator.userActivation;
    if (navigator.vibrate && (!act || act.hasBeenActive)) navigator.vibrate([200, 100, 200]);
  }
  function stopRinging() { clearInterval(chimeTimer); chimeTimer = null; }

  // A task that keeps reminding until it is done: marked "Keep reminding", or high priority.
  function nagging(t) { return !t.Done && (t.Nag || t.Priority === 2); }
  // Moves a task to another day/time (used by "This evening" and "Tomorrow morning").
  function rescheduleTask(id, when, message) {
    var y = find(id); if (!y) return;
    y.Date = key(when); y.Time = pad(when.getHours()) + ':' + pad(when.getMinutes());
    save(); say(message); render();
  }

  function showAlarm(t) {
    alarmShowing = t.Id;
    var c = cat(t.Category), box = $('alarm');
    box.innerHTML = '<div class="alarm-card"><div class="alarm-bell" aria-hidden="true">⏰</div>' +
      '<div class="alarm-time">' + timeDisp(t.Time) + '</div>' +
      '<div class="alarm-title">' + esc(t.Title) + '</div>' +
      (t.Notes ? '<div class="alarm-notes">' + esc(t.Notes.split('\n')[0]) + '</div>' : '') +
      '<div class="alarm-cat" style="--tc:' + c.color + '">' + c.emoji + ' ' + c.name + '</div>' +
      '<div class="alarm-actions"><button type="button" class="btn primary" data-a="done">✅ Done</button>' +
      '<div class="alarm-snooze"><button type="button" class="btn soft" data-a="s10">💤 +10 min</button>' +
      '<button type="button" class="btn soft" data-a="s60">⏳ +1 hour</button>' +
      '</div>' +
      (nagging(t) ? '<div class="alarm-nag">🔔 Keeps reminding you until it’s done</div>' : '') +
      '<button type="button" class="btn ghost" data-a="dismiss">Dismiss</button></div></div>';
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add('show'); });
    var rings = 0;
    needSound = !chimeReady;
    if (nagging(t)) snoozed[t.Id] = Date.now() + 7 * 60000;   // unless answered, ask again in 7 minutes
    ringAlarm(); stopRinging();
    // Rings every 4 seconds until you pick an option (no time limit).
    chimeTimer = setInterval(ringAlarm, 4000);
    box.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        delete snoozed[t.Id];
        if (a === 'done') { var x = find(t.Id); if (x) { x.Done = true; save(); } say('Nice, done! ✅'); }
        else if (a === 's10' || a === 's60') {
          // Snoozing moves the task itself: 4:00 PM + 10 min = 4:10 PM (from now if that time already passed).
          var mins = a === 's10' ? 10 : 60, sx = find(t.Id);
          if (sx && sx.Time) {
            var sp = sx.Time.split(':'), sd = parseKey(sx.Date); sd.setHours(+sp[0], +sp[1], 0, 0);
            var nw = new Date(sd.getTime() + mins * 60000);
            if (nw.getTime() <= Date.now()) nw = new Date(Date.now() + mins * 60000);
            rescheduleTask(t.Id, nw, 'Moved to ' + timeDisp(pad(nw.getHours()) + ':' + pad(nw.getMinutes())) + ' 💤');
          } else snoozed[t.Id] = Date.now() + mins * 60000;
        }
        else if (a === 'dismiss' && nagging(t)) {
          snoozed[t.Id] = Date.now() + 7 * 60000;
          say('I’ll ask again in 7 minutes 🔔');
        }
        hideAlarm();
        render();
      };
    });
  }
  function hideAlarm() {
    var box = $('alarm');
    stopRinging(); alarmShowing = null;
    box.classList.remove('show');
    setTimeout(function () { if (!alarmShowing) { box.hidden = true; box.innerHTML = ''; } checkAlarms(); }, 250);
  }

  function checkAlarms() {
    if (!alarmOn || alarmShowing) return;
    var now = Date.now(), tk = key(today()), next = null;
    tasks.some(function (t) {
      if (t.Done || !t.Time || t.Date !== tk) return false;
      var p = t.Time.split(':'), due = new Date(); due.setHours(+p[0], +p[1], 0, 0);
      var id = t.Id + '|' + t.Date + '|' + t.Time;
      if (snoozed[t.Id]) { if (snoozed[t.Id] > now) return false; delete snoozed[t.Id]; next = t; return true; }
      if (fired[id] || now < due.getTime() || now - due.getTime() > 2 * 3600000) return false;
      fired[id] = now; saveFired(); next = t; return true;
    });
    if (next) showAlarm(next);
  }

  // ---------- Streaks, briefing, wrap-up, weekly recap, Siri inbox ----------
  var BRIEF = 'dailyjoy.brief', WRAP = 'dailyjoy.wrap', WRAPSHOWN = 'dailyjoy.wrapShown', RECAPSHOWN = 'dailyjoy.recapShown', INBOX = 'dailyjoy.inbox';
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function atTime(d, hhmm) { var p = hhmm.split(':'); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0], +p[1]).getTime(); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  // Days in a row where everything planned was finished (today counts once it is all done).
  function allDone(list) { return list.length > 0 && list.every(function (t) { return t.Done; }); }
  function streakCount() {
    var n = 0, d = today();
    if (!allDone(tasksOn(key(d)))) d = addDays(d, -1);
    for (var i = 0; i < 400; i++) {
      if (!allDone(tasksOn(key(d)))) break;
      n++; d = addDays(d, -1);
    }
    return n;
  }

  // Extra notifications for the push server: morning briefing, evening wrap-up, repeat nags.
  function extraReminders(now) {
    var out = [], b = lsGet(BRIEF), w = lsGet(WRAP);
    for (var i = 0; i < 3; i++) {
      var d = addDays(today(), i), k = key(d);
      var open = tasksOn(k).filter(function (t) { return !t.Done; });
      if (!open.length) continue;
      if (b) {
        var ab = atTime(d, b);
        if (ab > now - 120000) {
          var timed = open.filter(function (t) { return t.Time; }).sort(function (x, y) { return x.Time < y.Time ? -1 : 1; })[0];
          out.push({ k: 'brief|' + k, time: '', at: new Date(ab).toISOString(),
            title: '☀️ ' + plural(open.length, 'task') + ' today' + (timed ? ', first one at ' + timeDisp(timed.Time) : '') });
        }
      }
      if (w) {
        var aw = atTime(d, w);
        if (aw > now - 120000) out.push({ k: 'wrap|' + k, time: '', at: new Date(aw).toISOString(),
          title: '🌙 ' + plural(open.length, 'task') + ' left. Open Daily Joy to move them to tomorrow' });
      }
      if (i < 2) open.forEach(function (t) {
        if (!t.Time || !nagging(t)) return;
        var due = atTime(d, t.Time);
        for (var n = 1; n <= 4; n++) {
          var an = due + n * 7 * 60000;
          if (an > now - 120000) out.push({ k: 'nag|' + t.Id + '|' + n + '|' + t.Date + '|' + t.Time, time: '', at: new Date(an).toISOString(),
            title: '🔔 Still to do: ' + t.Title });
        }
      });
    }
    return out;
  }

  // Pick a time (or Off) for the briefing / wrap-up.
  function timeSheet(kind) {
    var isB = kind === 'brief', lsKey = isB ? BRIEF : WRAP, cur = lsGet(lsKey);
    var opts = isB ? ['06:30', '07:00', '08:00', '09:00'] : ['18:00', '20:00', '21:00', '22:00'];
    var html = '<h2>' + (isB ? '☀️ Morning briefing' : '🌙 Evening wrap-up') + '</h2>' +
      '<p class="muted">' + (isB ? 'A morning note like “5 tasks today, first one at 9:00”.' : 'An evening nudge like “2 tasks left. Move them to tomorrow?”.') +
      ' Turn on <b>Alerts when closed</b> in Options to get it as a notification.</p>' +
      '<div class="seg" id="tsOpts">' + opts.map(function (o) { return '<button type="button" data-v="' + o + '">' + timeDisp(o) + '</button>'; }).join('') +
      '<button type="button" data-v="">Off</button></div>' +
      '<div class="row" style="margin-top:10px"><span class="muted">Or pick a time</span><input class="field" type="time" id="tsTime" aria-label="Time"></div>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="tsDone">Done</button></div>';
    openSheet(html, function (s) {
      function show() {
        s.querySelectorAll('#tsOpts button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === cur); });
        $('tsTime').value = cur;
      }
      function set(v) {
        cur = v; lsSet(lsKey, v); show(); queuePush();
        say(v ? (isB ? 'Morning briefing at ' : 'Evening wrap-up at ') + timeDisp(v) + (isB ? ' ☀️' : ' 🌙') : (isB ? 'Morning briefing off' : 'Evening wrap-up off'));
      }
      s.querySelectorAll('#tsOpts button').forEach(function (b) { b.onclick = function () { set(b.dataset.v); }; });
      $('tsTime').onchange = function () { set(this.value || ''); };
      $('tsDone').onclick = closeSheet;
      show();
    });
  }

  function wrapDue() {
    var w = lsGet(WRAP);
    if (!w || lsGet(WRAPSHOWN) === key(today()) || Date.now() < atTime(today(), w)) return false;
    return tasksOn(key(today())).some(function (t) { return !t.Done; });
  }
  function wrapSheet() {
    lsSet(WRAPSHOWN, key(today()));
    var tk = key(today()), open = tasksOn(tk).filter(function (t) { return !t.Done; });
    if (!open.length) return;
    var html = '<h2>🌙 Evening wrap-up</h2><p class="muted">' + plural(open.length, 'task') + ' still open today:</p>' +
      '<ul class="steps">' + open.slice(0, 6).map(function (t) { return '<li>' + esc(t.Title) + '</li>'; }).join('') + (open.length > 6 ? '<li>…and ' + (open.length - 6) + ' more</li>' : '') + '</ul>' +
      '<div class="opts"><button type="button" class="opt" data-v="move"><span class="oe">➡️</span><span class="ol">Move them to tomorrow</span></button>' +
      '<button type="button" class="opt" data-v="keep"><span class="oe">👍</span><span class="ol">Leave them for now</span></button></div>';
    openSheet(html, function (s) {
      s.querySelectorAll('.opt').forEach(function (b) {
        b.onclick = function () {
          closeSheet();
          if (b.dataset.v !== 'move') return;
          setTimeout(function () {
            var nk = key(addDays(today(), 1));
            withUndo('Moved ' + open.length + ' to tomorrow ➡️', function () {
              tasks.forEach(function (t) { if (t.Date === tk && !t.Done) t.Date = nk; });
            });
          }, 350);
        };
      });
    });
  }

  // Weekly recap: done tasks of the week starting on `mon`.
  function weekStats(mon) {
    var total = 0, days = [], cats = {};
    for (var i = 0; i < 7; i++) {
      var d = addDays(mon, i), done = tasksOn(key(d)).filter(function (t) { return t.Done; });
      total += done.length; days.push({ d: d, n: done.length });
      done.forEach(function (t) { cats[t.Category] = (cats[t.Category] || 0) + 1; });
    }
    var best = days.slice().sort(function (a, b) { return b.n - a.n; })[0];
    var fav = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
    return { total: total, best: best && best.n ? best : null, fav: fav ? cat(fav) : null };
  }
  function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function recapSheet(mon) {
    mon = mon || mondayOf(today());
    var st = weekStats(mon), thisWeek = key(mon) === key(mondayOf(today()));
    var head = st.total >= 20 ? 'You crushed it 🎉' : st.total >= 8 ? 'Great week! 🌟' : st.total ? 'Every step counts 🌱' : 'A quiet week 🌙';
    var html = '<h2>📊 ' + (thisWeek ? 'Your week' : 'Last week') + '</h2><div class="recap">' +
      '<div class="recap-big">' + st.total + '</div>' +
      '<div class="recap-title">' + (st.total ? 'task' + (st.total === 1 ? '' : 's') + ' finished. ' + head : head + ' Nothing finished yet') + '</div>' +
      '<div class="recap-row">' +
      (st.best ? '<span>🏆 Best day: <b>' + WDL[st.best.d.getDay()] + '</b> (' + st.best.n + ' done)</span>' : '') +
      (st.fav ? '<span>' + st.fav.emoji + ' Favourite category: <b>' + st.fav.name + '</b></span>' : '') +
      (streakCount() >= 2 ? '<span>🔥 ' + streakCount() + ' days in a row finishing everything</span>' : '') +
      '</div></div><div class="sheet-actions"><button type="button" class="btn primary" id="rcOk">Nice! 🎈</button></div>';
    openSheet(html, function () { $('rcOk').onclick = closeSheet; if (st.total) setTimeout(confetti, 300); });
  }
  function recapDue() {
    var now = new Date(), dow = now.getDay(), mon;
    if (dow === 0 && now.getHours() >= 18) mon = mondayOf(today());
    else if (dow === 1) mon = addDays(mondayOf(today()), -7);
    else return null;
    return lsGet(RECAPSHOWN) === key(mon) ? null : mon;
  }

  // Shown when the app is opened (for example by tapping the evening notification), never over something else.
  function autoPrompts() {
    if (alarmShowing || !$('sheet').hidden || !$('alarm').hidden || $('splash')) return;
    // Someone who already uses the app (has tasks or a name) never sees the first-run welcome.
    if (!lsGet(WELCOMED)) {
      if (tasks.length || myName()) lsSet(WELCOMED, '1');
      else { welcomeSheet(); return; }
    }
    if (wrapDue()) { wrapSheet(); return; }
    var mon = recapDue();
    if (mon && weekStats(mon).total) { lsSet(RECAPSHOWN, key(mon)); recapSheet(mon); }
  }

  // "Hey Siri, add to Daily Joy": a Shortcut sends the text to the push server, and the app picks it up here.
  function inboxCode() {
    var c = lsGet(INBOX);
    if (!c) {
      var a = new Uint8Array(12), s = '';
      (window.crypto || window.msCrypto).getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(a[i] % 31);
      c = s; lsSet(INBOX, c);
    }
    return c;
  }
  var pulling = false;
  function pullInbox() {
    var c = lsGet(INBOX);
    if (!c || !PUSH_SERVER || pulling) return;
    pulling = true;
    fetch(PUSH_SERVER + '/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        pulling = false;
        var items = (d && d.items) || [];
        items.forEach(function (x) { addByVoice(String(x), true); });
        if (items.length > 1) say('Added ' + items.length + ' tasks from Siri 🗣️');
      })
      .catch(function () { pulling = false; });
  }
  function siriSheet() {
    var code = inboxCode(), link = PUSH_SERVER + '/add?c=' + code + '&t=';
    var html = '<h2>🗣️ Hey Siri, add a task</h2>' +
      '<p class="muted">Set this up once, then just say <b>“Hey Siri, Add to Daily Joy”</b> and speak your task, like “call mom at 5”.</p>' +
      '<ol class="steps">' +
      '<li>Open the <b>Shortcuts</b> app, tap <b>+</b>, and name it <b>Add to Daily Joy</b>.</li>' +
      '<li>Add the action <b>Ask for Input</b> (type Text, question “What should I add?”).</li>' +
      '<li>Add <b>URL Encode</b> and set it to <i>Provided Input</i>.</li>' +
      '<li>Add <b>Get Contents of URL</b>. Paste the link below, then tap at its end and insert the <i>URL Encoded Text</i> variable.</li>' +
      '<li>Done! Say “Hey Siri, Add to Daily Joy”. The task appears next time you open the app.</li></ol>' +
      '<button type="button" class="btn soft cal-btn" id="siriCopy">📋 Copy the link</button>' +
      '<p class="muted" style="word-break:break-all"><code>' + esc(link) + '</code></p>' +
      '<div class="sheet-actions"><button type="button" class="btn primary" id="siriOk">Done</button></div>';
    openSheet(html, function () {
      $('siriOk').onclick = closeSheet;
      $('siriCopy').onclick = function () {
        var done = function () { say('Link copied 📋'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { say('Press and hold the link to copy it'); });
        else say('Press and hold the link to copy it');
      };
    });
  }

  // ---------- Effects (sparkle & confetti) ----------
  var fx = $('fx'), ctx = fx.getContext('2d'), parts = [], running = false;
  function sizeFx() {
    var r = window.devicePixelRatio || 1;
    fx.width = innerWidth * r; fx.height = innerHeight * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  function reduced() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function sparkle(el, n) {
    if (!el || reduced()) return;
    var b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * .4, sp = 2 + Math.random() * 2.5;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.02, s: 3 + Math.random() * 3,
                   c: pick(CONFETTI), life: 34 + Math.random() * 10, star: true, rot: 0, vr: 0 });
    }
    loop();
  }
  function confetti() {
    if (reduced()) return;
    var w = innerWidth;
    for (var i = 0; i < 140; i++) {
      parts.push({ x: w / 2 + (Math.random() - .5) * w * .3, y: innerHeight * .35, vx: (Math.random() - .5) * 13, vy: -6 - Math.random() * 9,
                   g: 0.28, s: 6 + Math.random() * 6, c: pick(CONFETTI), life: 110 + Math.random() * 60, star: false,
                   rot: Math.random() * 6, vr: (Math.random() - .5) * .35 });
    }
    loop();
  }
  function loop() {
    if (running) return;
    running = true; sizeFx();
    (function step() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(function (p) { return p.life > 0 && p.y < innerHeight + 30; });
      parts.forEach(function (p) {
        p.life--; p.vy += p.g; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.globalAlpha = Math.min(1, p.life / 25);
        ctx.fillStyle = p.c;
        if (p.star) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.s * (p.life / 44)), 0, Math.PI * 2); ctx.fill(); }
        else {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2 * (0.6 + Math.abs(Math.sin(p.rot * 2)))); ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(step); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    })();
  }

  // ---------- Wiring ----------
  $('addForm').addEventListener('submit', addTask);
  $('micBtn').onclick = voiceAdd;
  $('catChip').onclick = function () { catSheet(newCat, function (v) { newCat = v; renderAddChips(); }); };
  $('repChip').onclick = function () { repeatSheet(newRepeat, function (v) { newRepeat = v; renderAddChips(); }); };
  $('prioChip').onclick = function () { prioSheet(newPrio, function (v) { newPrio = v; renderAddChips(); }); };
  $('newTime').addEventListener('change', function () { newTime = this.value || ''; renderAddChips(); });
  $('newTime').addEventListener('input', function () { newTime = this.value || ''; renderAddChips(); });
  $('timeClear').onclick = function () { newTime = ''; renderAddChips(); };

  $('days').addEventListener('click', function (e) { var b = e.target.closest('.day'); if (b) setView(parseKey(b.dataset.k)); });
  $('prevWeek').onclick = function () { setView(addDays(view, -7)); };
  $('nextWeek').onclick = function () { setView(addDays(view, 7)); };
  $('title').onclick = function () { setView(today()); };

  // swipe the hero left/right to change day
  (function () {
    var sx = 0, sy = 0, on = false;
    var hero = document.querySelector('.hero');
    hero.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; on = true; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (!on) return; on = false;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setView(addDays(view, dx < 0 ? 1 : -1));
    }, { passive: true });
  })();

  // Swipe a task: right = done, left = move to the next day.
  // Minutes until a timed reminder is due (0 when it has no time or the time has come).
  function minutesUntil(t) {
    if (!t.Time) return 0;
    var d = parseKey(t.Date), p = t.Time.split(':');
    var due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0], +p[1]);
    return Math.max(0, Math.ceil((due - Date.now()) / 60000));
  }
  function waitText(mins) {
    if (mins < 2) return 'a minute';
    if (mins < 60) return mins + ' minutes';
    if (mins < 60 * 24) { var h = Math.floor(mins / 60), m = mins % 60; return h + (h === 1 ? ' hour' : ' hours') + (m && h < 6 ? ' ' + m + ' min' : ''); }
    var dd = Math.round(mins / 1440); return dd + (dd === 1 ? ' day' : ' days');
  }
  var EARLY = [
    'Early bird! 🐦',
    'Ahead of schedule! 🚀',
    'Look at you, time traveller ⏰',
    'Future you says thanks 🙏',
    'Done before it was due 😎',
    'Speedrun complete! 🏁',
    'Way ahead of the clock 🕰️',
    'Who needs reminders anyway? 💪'
  ];
  var BACK_TO_TODO = [
    'Back on the list! ↩️',
    'Round two! 🔁',
    'Plot twist, it’s not over 🎬',
    'Back in the game 🎮',
    'Unfinished business 🕵️',
    'Second helping coming up 🍽️',
    'Rewound! ⏪',
    'Okay, one more time 💪'
  ];
  var lastSwipe = 0;
  function moveOneDay(id) {
    var t = find(id); if (!t) return;
    var to = addDays(parseKey(t.Date), 1);
    withUndo('Moved to ' + friendly(to) + ' ➡️', function () { t.Date = key(to); });
  }
  (function () {
    var list = $('list'), card = null, sx = 0, sy = 0, dx = 0, dir = null, LIMIT = 90;
    function reset(c) {
      c.style.transition = 'transform .2s ease'; c.style.transform = '';
      delete c.dataset.swipe;
      setTimeout(function () { c.style.transition = ''; }, 220);
    }
    list.addEventListener('touchstart', function (e) {
      card = e.touches.length === 1 ? e.target.closest('.task') : null;
      if (!card) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; dir = null;
    }, { passive: true });
    list.addEventListener('touchmove', function (e) {
      if (!card) return;
      var ddx = e.touches[0].clientX - sx, ddy = e.touches[0].clientY - sy;
      if (dir === null) {
        if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
        dir = Math.abs(ddx) > Math.abs(ddy) * 1.4 ? 'h' : 'v';
      }
      if (dir !== 'h') { card = null; return; }
      dx = Math.max(-150, Math.min(150, ddx));
      card.style.transition = 'none';
      card.style.transform = 'translateX(' + dx + 'px)';
      var isDone = card.classList.contains('done');
      card.dataset.swipe = Math.abs(dx) < LIMIT ? 'hint' : (dx > 0 ? 'move' : (isDone ? 'undo' : 'done'));
    }, { passive: true });
    function end() {
      var c = card; card = null;
      if (!c || dir !== 'h') return;
      lastSwipe = Date.now();
      var id = c.dataset.id;
      if (Math.abs(dx) < LIMIT) { reset(c); return; }
      if (dx < 0) {
        var tk = find(id), wait = tk && !tk.Done ? minutesUntil(tk) : 0;
        if (tk && tk.Done) { reset(c); toggle(id, c); say(pick(BACK_TO_TODO)); }   // swipe a finished task back onto the to-do list
        else {
          reset(c); toggle(id, c);
          // finished before its time: cheer the early bird (unless the whole day is done; that has its own party)
          if (wait > 0 && !tasksOn(tk.Date).every(function (x) { return x.Done; })) say(pick(EARLY) + ' — ' + waitText(wait) + ' ahead of time');
        }
      }
      else { c.style.transition = 'transform .2s ease, opacity .2s'; c.style.transform = 'translateX(110%)'; c.style.opacity = '0'; setTimeout(function () { moveOneDay(id); }, 180); }
    }
    list.addEventListener('touchend', end, { passive: true });
    list.addEventListener('touchcancel', function () { if (card) { reset(card); card = null; } }, { passive: true });
  })();

  $('list').addEventListener('click', function (e) {
    if (Date.now() - lastSwipe < 400) return;
    var card = e.target.closest('.task'); if (!card) return;
    if (e.target.closest('.check')) toggle(card.dataset.id, card);
    else editSheet(card.dataset.id);
  });
  document.querySelector('.filters').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (b) { filter = b.dataset.f; render(); }
  });
  $('cats').addEventListener('click', function (e) {
    var b = e.target.closest('.pill'); if (b) { catFilter = b.dataset.c || null; render(); }
  });
  $('bannerBtn').onclick = bringOverdue;
  $('themeBtn').onclick = function () { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };
  $('menuBtn').onclick = menuSheet;
  $('backdrop').onclick = closeSheet;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  $('importFile').addEventListener('change', function () { if (this.files[0]) importTasks(this.files[0]); this.value = ''; });

  // other tabs / the day rolling over
  window.addEventListener('storage', function (e) { if (e.key === STORE || e.key === SERIES) { tasks = load(); series = loadSeries(); render(); } });
  var lastDay = key(today());
  function tick() {
    var k = key(today());
    if (k !== lastDay) { if (key(view) === lastDay) view = today(); lastDay = k; }
    fillRepeats();
    render();
    checkAlarms();
    if (pushOn && Date.now() - pushLast > 10 * 60000) syncPush();   // refresh the server's list now and then
    pullInbox();
    autoPrompts();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 60000);
  setInterval(checkAlarms, 3000);
  // iOS can pause a page's timers; check again the moment the app wakes, regains focus, or the server's push arrives.
  window.addEventListener('focus', checkAlarms);
  window.addEventListener('pageshow', checkAlarms);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'due') checkAlarms(); });
  window.addEventListener('resize', function () { if (running) sizeFx(); });

  // "Add to Home Screen" hint for iPhone Safari
  (function () {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    var closed = false; try { closed = localStorage.getItem(HINT) === '1'; } catch (e) {}
    if (ios && !standalone && !closed) $('installHint').hidden = false;
    $('hintClose').onclick = function () { $('installHint').hidden = true; try { localStorage.setItem(HINT, '1'); } catch (e) {} };
  })();

  // No-connection notice: shown only when the phone has no network at all (no Wi-Fi and no cellular).
  (function () {
    var bar = $('offlineBar');
    if (!bar) return;
    function check() {
      if (navigator.onLine === false) { if (!bar.dataset.closed) bar.hidden = false; }
      else { bar.hidden = true; delete bar.dataset.closed; }
    }
    $('offlineClose').onclick = function () { bar.hidden = true; bar.dataset.closed = '1'; };
    window.addEventListener('offline', check);
    window.addEventListener('online', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    check();
  })();

  // Offline support
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    // A new version takes over while this page is open; this page's code is still the old one until it reloads.
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadController) $('updateBar').hidden = false; });
    $('updateBtn').onclick = function () { location.reload(); };
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) { reg.update().catch(function () {}); }).catch(function () {});
    });
  }

  // keep the browser chrome colour in step with the theme on first load
  (function () { var m = document.querySelector('meta[name="theme-color"]'); if (m && document.documentElement.dataset.theme === 'dark') m.setAttribute('content', '#3a2160'); })();

  // Launch splash: let the little show play (about 1.9 s from launch), then zoom it away. A tap skips it.
  (function () {
    var sp = $('splash'); if (!sp) return;
    var gone = false;
    function hide() {
      if (gone) return; gone = true;
      sp.classList.add('gone'); setTimeout(function () { sp.remove(); }, 480);
    }
    var since = (window.performance && performance.now) ? performance.now() : 0;
    setTimeout(hide, reduced() ? 400 : Math.max(300, 1900 - since));
    sp.addEventListener('click', hide);
    sp.addEventListener('touchstart', hide, { passive: true });
  })();

  fillRepeats();
  render();
  checkAlarms();
  pullInbox();
  setTimeout(autoPrompts, 2600);   // after the splash has gone
})();
