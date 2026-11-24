/* Daily Joy — web / iPhone version.
   Tasks live in this device's localStorage, using the same JSON shape as the
   desktop app's tasks.json, so Export/Import moves tasks between the two. */
(function () {
  'use strict';

  // ---------- Data & constants ----------
  var STORE = 'dailyjoy.tasks', THEME = 'dailyjoy.theme', HINT = 'dailyjoy.hintClosed';

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
  function normalize(t) {
    return {
      Id: t.Id || newId(),
      Title: String(t.Title || '').trim() || 'Untitled',
      Notes: t.Notes || '',
      Date: /^\d{4}-\d{2}-\d{2}$/.test(t.Date) ? t.Date : key(today()),
      Time: /^\d{2}:\d{2}$/.test(t.Time || '') ? t.Time : '',
      Priority: [0, 1, 2].indexOf(+t.Priority) >= 0 ? +t.Priority : 1,
      Done: !!t.Done,
      Created: +t.Created || nowTicks(),
      Category: cat(t.Category).key
    };
  }
  function load() {
    try { var a = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(a) ? a.map(normalize) : []; }
    catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(tasks)); }
    catch (e) { say('Could not save on this device 😢'); }
  }
  function snapshot() { return JSON.parse(JSON.stringify(tasks)); }

  // ---------- State ----------
  var tasks = load();
  var view = today();
  var filter = 'all', catFilter = null;
  var newCat = 'general', newPrio = 1, newTime = '';

  // ---------- Rendering ----------
  var RING_C = 2 * Math.PI * 35;

  function tasksOn(k) { return tasks.filter(function (t) { return t.Date === k; }); }
  function sortTodo(a, b) {
    if (!!a.Time !== !!b.Time) return a.Time ? -1 : 1;
    if (a.Time !== b.Time) return a.Time < b.Time ? -1 : 1;
    if (a.Priority !== b.Priority) return b.Priority - a.Priority;
    return a.Created - b.Created;
  }

  function greeting() {
    var n = diffDays(view, today());
    if (n > 0) return '📅 Planning ahead, nice!';
    if (n < 0) return '🕰 Looking back';
    var h = new Date().getHours();
    if (h < 5) return '🌙 Burning the midnight oil?';
    if (h < 12) return '☀️ Good morning, sunshine!';
    if (h < 17) return '🌤 Good afternoon!';
    if (h < 21) return '🌆 Good evening!';
    return '🌙 Winding down for the night';
  }

  function render() {
    var vk = key(view), dayTasks = tasksOn(vk);
    var total = dayTasks.length, done = dayTasks.filter(function (t) { return t.Done; }).length;
    var ratio = total ? done / total : 0;

    // hero
    $('greet').textContent = greeting();
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
      if (!total) em = ['🌈', 'A fresh, empty day!', 'Type a task above and press Enter ✨'];
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
  }

  function card(t) {
    var c = cat(t.Category), p = prio(t.Priority), meta = '';
    var isLate = !t.Done && t.Time && t.Date === key(today()) && t.Time < pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
    if (t.Time) meta += '<span class="tag" style="--tc:' + (isLate ? '#ef4444' : '#7a6e8e') + '">' + (isLate ? '⏰ ' : '🕒 ') + timeDisp(t.Time) + '</span>';
    if (t.Priority !== 1) meta += '<span class="tag" style="--tc:' + p.color + '">' + p.emoji + ' ' + p.name + '</span>';
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
    var html = '<button type="button" class="pill' + (!catFilter ? ' on' : '') + '" data-c="">🌈 All</button>';
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
    $('timeLabel').textContent = newTime ? '🕒 ' + timeDisp(newTime) : '🕒 Add time';
    $('newTime').value = newTime;
    $('timeClear').hidden = !newTime;
  }

  // ---------- Actions ----------
  function addTask(e) {
    e.preventDefault();
    var input = $('newTitle'), text = input.value.trim();
    if (!text) { input.focus(); return; }
    var time = newTime, parsed = extractTime(text);
    if (parsed) { text = parsed.rest; if (!time) time = parsed.time; }
    tasks.push(normalize({ Title: text, Date: key(view), Time: time, Priority: newPrio, Category: newCat, Created: nowTicks() }));
    save();
    input.value = '';
    newTime = '';
    if (filter === 'done') filter = 'all';
    if (catFilter && catFilter !== newCat) catFilter = null;
    render();
    sparkle(document.querySelector('.add-btn'), 10);
    say(friendlyAdd(text, time));
  }
  function friendlyAdd(text, time) {
    var when = diffDays(view, today()) === 0 ? '' : ' for ' + friendly(view);
    return 'Added' + when + (time ? ' at ' + timeDisp(time) : '') + ' 👍';
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
    var before = snapshot();
    change();
    save(); render();
    var undo = function () { tasks = before.map(normalize); save(); render(); say('Undone ↩️'); };
    if (message) say(message, undo);
    return undo;
  }

  function deleteTask(id) {
    var t = find(id); if (!t) return;
    withUndo('Deleted “' + truncate(t.Title, 22) + '”', function () { tasks = tasks.filter(function (x) { return x.Id !== id; }); });
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

  function setView(d) { view = d; catFilter = null; render(); }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME, t); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#3a2160' : '#ff6f7d');
    render();
  }

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
      var added = 0, updated = 0;
      var undo = withUndo('', function () {
        data.forEach(function (raw) {
          if (!raw || typeof raw !== 'object') return;
          var t = normalize(raw), cur = find(t.Id);
          if (cur) { Object.assign(cur, t); updated++; } else { tasks.push(t); added++; }
        });
      });
      say('Imported: ' + added + ' new, ' + updated + ' updated 📥', undo);
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

  function menuSheet() {
    var dark = document.documentElement.dataset.theme === 'dark';
    var items = [
      ['today', '☀️', 'Jump to today', ''],
      ['move', '➡️', 'Move unfinished to tomorrow', ''],
      ['clear', '🧹', 'Clear done tasks', ''],
      ['theme', dark ? '☀️' : '🌙', dark ? 'Light theme' : 'Dark theme', ''],
      ['export', '📦', 'Export tasks', 'Save a .json backup'],
      ['import', '📥', 'Import tasks', 'From a backup or the PC app']
    ];
    var html = '<h2>Options</h2><div class="opts">';
    items.forEach(function (it) {
      html += '<button type="button" class="opt" data-a="' + it[0] + '"><span class="oe">' + it[1] + '</span><span class="ol">' + it[2] + '</span><span class="os">' + it[3] + '</span></button>';
    });
    html += '</div><p class="muted">Your tasks are saved on this device only. Use Export and Import to move them to another phone or to the Daily Joy PC app (its file is <b>%APPDATA%\\DailyTasks\\tasks.json</b>).</p>';
    openSheet(html, function (s) {
      s.querySelectorAll('.opt').forEach(function (b) {
        b.onclick = function () {
          var a = b.dataset.a;
          if (a === 'import') { $('importFile').click(); closeSheet(); return; } // click must happen inside the tap
          closeSheet();
          setTimeout(function () {
            if (a === 'today') setView(today());
            else if (a === 'move') moveUnfinished();
            else if (a === 'clear') clearDone();
            else if (a === 'theme') setTheme(dark ? 'light' : 'dark');
            else if (a === 'export') exportTasks();
          }, 120);
        };
      });
    });
  }

  function editSheet(id) {
    var t = find(id); if (!t) return;
    var d = { Date: t.Date, Time: t.Time, Priority: t.Priority, Category: t.Category };
    var tk = key(today()), tmk = key(addDays(today(), 1));
    var html = '<h2>Edit task</h2>' +
      '<input class="field" id="eTitle" maxlength="200" value="' + esc(t.Title) + '" aria-label="Title">' +
      '<h3>When</h3><div class="seg" id="eWhen">' +
        '<button type="button" data-v="' + tk + '">☀️ Today</button>' +
        '<button type="button" data-v="' + tmk + '">🌅 Tomorrow</button></div>' +
      '<div class="row" style="margin-top:8px"><input class="field" type="date" id="eDate" aria-label="Date">' +
        '<input class="field" type="time" id="eTime" aria-label="Time"></div>' +
      '<div class="row" style="margin-top:6px"><span class="muted" id="eTimeTxt"></span>' +
        '<button type="button" class="btn ghost small" id="eNoTime" style="flex:0 0 auto">No time</button></div>' +
      '<h3>Priority</h3><div class="seg" id="ePrio">' +
        PRIOS.map(function (p, i) { return '<button type="button" data-v="' + i + '" style="--sc:' + p.color + '">' + p.emoji + ' ' + p.name + '</button>'; }).join('') + '</div>' +
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
        $('eDate').value = d.Date; $('eTime').value = d.Time;
        $('eTimeTxt').textContent = d.Time ? '🕒 ' + timeDisp(d.Time) + ' · ' + friendly(parseKey(d.Date)) : 'No time set · ' + friendly(parseKey(d.Date));
        $('eNoTime').hidden = !d.Time;
      }
      s.querySelectorAll('#eWhen button').forEach(function (b) { b.onclick = function () { d.Date = b.dataset.v; sync(); }; });
      s.querySelectorAll('#ePrio button').forEach(function (b) { b.onclick = function () { d.Priority = +b.dataset.v; sync(); }; });
      s.querySelectorAll('#eCat button').forEach(function (b) { b.onclick = function () { d.Category = b.dataset.v; sync(); }; });
      $('eDate').onchange = function () { if (this.value) d.Date = this.value; sync(); };
      $('eTime').onchange = function () { d.Time = this.value || ''; sync(); };
      $('eNoTime').onclick = function () { d.Time = ''; sync(); };
      $('eCancel').onclick = closeSheet;
      $('eDel').onclick = function () { closeSheet(); setTimeout(function () { deleteTask(id); }, 150); };
      $('eSave').onclick = function () {
        var title = $('eTitle').value.trim();
        if (!title) { $('eTitle').focus(); return; }
        var moved = d.Date !== t.Date;
        t.Title = title; t.Notes = $('eNotes').value.replace(/\s+$/, '');
        t.Date = d.Date; t.Time = d.Time; t.Priority = d.Priority; t.Category = d.Category;
        save(); closeSheet(); render();
        say(moved ? 'Moved to ' + friendly(parseKey(d.Date)) + ' 📅' : 'Saved ✅');
      };
      sync();
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
        if (p.star) { ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (p.life / 44), 0, Math.PI * 2); ctx.fill(); }
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
  $('catChip').onclick = function () { catSheet(newCat, function (v) { newCat = v; renderAddChips(); }); };
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

  $('list').addEventListener('click', function (e) {
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
  window.addEventListener('storage', function (e) { if (e.key === STORE) { tasks = load(); render(); } });
  var lastDay = key(today());
  function tick() {
    var k = key(today());
    if (k !== lastDay) { if (key(view) === lastDay) view = today(); lastDay = k; }
    render();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  setInterval(tick, 60000);
  window.addEventListener('resize', function () { if (running) sizeFx(); });

  // "Add to Home Screen" hint for iPhone Safari
  (function () {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    var closed = false; try { closed = localStorage.getItem(HINT) === '1'; } catch (e) {}
    if (ios && !standalone && !closed) $('installHint').hidden = false;
    $('hintClose').onclick = function () { $('installHint').hidden = true; try { localStorage.setItem(HINT, '1'); } catch (e) {} };
  })();

  // Offline support
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  // keep the browser chrome colour in step with the theme on first load
  (function () { var m = document.querySelector('meta[name="theme-color"]'); if (m && document.documentElement.dataset.theme === 'dark') m.setAttribute('content', '#3a2160'); })();

  render();
})();
