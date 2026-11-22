/* Games page (21 Nov 2026). See src/games.njk for what this is and why.

   THE PUZZLE DAY. A new set appears at 06:00 UK time. Nothing runs at six:
   the browser takes the time in Largs, subtracts six hours, and the date of
   that moment is the "puzzle day". Everyone gets the same puzzles because
   every one of them is worked out from, or looked up by, that date.

   WHERE THE PUZZLES COME FROM.
     Crossword  /assets/games/xw-YYYY-MM.json, built in advance by
                scripts/make-games.mjs from the clue bank. Two a day.
     Sudoku     made here, in the browser, from the date. Checked to have
                exactly one solution.
     Wee Wurd   the day's two words are picked by the date from the lists
                in /assets/games/wurd.json. Never call it anything else:
                the well-known name belongs to a newspaper.

   WHAT IS KEPT. Progress, times and the days played are kept on the
   reader's own device (localStorage) and nowhere else. Nothing is sent
   anywhere. The privacy page says so. Every read and write is guarded:
   with storage switched off the games still work, they just forget. */
(function () {
  "use strict";
  var root = document.getElementById("games"); if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function mmss(s) { return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function words(s) { var m = Math.floor(s / 60), r = s % 60; return m ? m + " min " + r + " s" : r + (r === 1 ? " second" : " seconds"); }

  /* ---------- the puzzle day ---------- */
  var SIX_HOURS = 6 * 3600e3;
  function dayOf(ms) {
    var parts = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })
      .formatToParts(new Date(ms - SIX_HOURS)).forEach(function (p) { parts[p.type] = p.value; });
    var iso = parts.year + "-" + parts.month + "-" + parts.day, utc = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    var monthName = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" }).format(new Date(utc));
    return { iso: iso, num: Math.round(utc / 864e5), label: parts.weekday + " " + (+parts.day) + " " + monthName, short: (+parts.day) + " " + monthName.slice(0, 3) };
  }
  var TODAY = dayOf(Date.now()), ISO = TODAY.iso, DAY = TODAY.label;
  // If the page is left open past six in the morning, fetch the new set when the reader comes back to it.
  document.addEventListener("visibilitychange", function () { if (!document.hidden && dayOf(Date.now()).iso !== ISO) location.reload(); });

  /* ---------- housekeeping: forget puzzles more than a week old ---------- */
  var PRE = "lg-games:";
  try {
    var old = [], cutoff = dayOf(Date.now() - 7 * 864e5).iso;
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i), m = k && k.indexOf(PRE) === 0 && k.match(/(\d{4}-\d\d-\d\d)/); if (m && m[1] < cutoff) old.push(k); }
    old.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}

  /* ---------- days played, and the run of them ---------- */
  function played() { var p = load(PRE + "played"); return Array.isArray(p) ? p : []; }
  function markPlayed() { var p = played(); if (p.indexOf(ISO) < 0) { p.push(ISO); store(PRE + "played", p.slice(-400)); } showStreak(); }
  function streak() {
    var p = played(), n = 0, t = Date.now();
    if (p.indexOf(ISO) < 0) t -= 864e5;                     // not played yet today: the run still stands until tomorrow
    while (p.indexOf(dayOf(t).iso) >= 0) { n++; t -= 864e5; }
    return n;
  }
  function streakText() { var n = streak(); return n > 1 ? "Played " + n + " days running" : ""; }
  function showStreak() { var s = $("gm-streak"); if (s) { s.textContent = streakText(); s.hidden = !s.textContent; } }

  /* ---------- a clock that starts with the first move ---------- */
  function Clock(key, out) {
    var st = load(key) || { ms: 0, done: false }, since = null, tick = null;
    function total() { return Math.round((st.ms + (since ? Date.now() - since : 0)) / 1000); }
    function show() { out.textContent = "Time " + mmss(total()); }
    function save() { store(key, { ms: st.ms + (since ? Date.now() - since : 0), done: st.done }); }
    show();
    return {
      start: function () { if (since || st.done) return; since = Date.now(); tick = setInterval(function () { show(); save(); }, 1000); },
      pause: function () { if (!since) return; st.ms += Date.now() - since; since = null; clearInterval(tick); save(); },
      finish: function () { this.pause(); st.done = true; save(); show(); return total(); },
      reset: function () { this.pause(); st = { ms: 0, done: false }; save(); show(); },
      done: function () { return st.done; }, seconds: total
    };
  }

  /* ---------- sharing a result ---------- */
  var LINK = "largs.scot/games/";
  function copyText(text, btn) {
    var done = function () { var was = btn.textContent; btn.textContent = "Copied. Paste it anywhere"; setTimeout(function () { btn.textContent = was; }, 2500); };
    var fallback = function () {     // older browsers: put the words in a box, selected, for the reader to copy
      var box = $("gm-sharebox"); box.hidden = false; box.value = text; box.focus(); box.select();
      try { if (document.execCommand("copy")) done(); } catch (e) {}
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function shareButton(text, label) { var b = el("button", "gm-share", label || "Share my result"); b.type = "button"; b.addEventListener("click", function () { copyText(text, b); }); return b; }

  /* ---------- solved ---------- */
  var COLOURS = ["#25655C", "#BFDED2", "#F7E2A8", "#B07A1F", "#C03B2B", "#FFFFFF"], raf = null;
  function confetti() {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = $("gm-confetti"), w = cv.width = cv.clientWidth, h = cv.height = cv.clientHeight, g = cv.getContext("2d"), t0 = performance.now();
    var bits = []; for (var i = 0; i < 150; i++) bits.push({ x: w / 2 + (Math.random() - .5) * 80, y: h * .42, vx: (Math.random() - .5) * 13, vy: -6 - Math.random() * 11,
      s: 5 + Math.random() * 7, r: Math.random() * 6.3, vr: (Math.random() - .5) * .4, c: COLOURS[i % COLOURS.length], round: i % 4 === 0 });
    cancelAnimationFrame(raf);
    (function frame(t) {
      g.clearRect(0, 0, w, h);
      var alive = false, fade = Math.max(0, 1 - (t - t0) / 4200);
      bits.forEach(function (b) {
        b.vy += .28; b.vx *= .992; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        if (b.y < h + 20) alive = true;
        g.save(); g.globalAlpha = fade; g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c;
        if (b.round) { g.beginPath(); g.arc(0, 0, b.s / 2, 0, 6.3); g.fill(); } else g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        g.restore();
      });
      if (alive && fade > 0) raf = requestAnimationFrame(frame); else g.clearRect(0, 0, w, h);
    })(t0);
  }
  var lastFocus = null;
  function celebrate(kicker, headline, extra, shareText) {
    $("gm-win-k").textContent = kicker; $("gm-win-t").textContent = headline; $("gm-win-s").textContent = extra;
    var run = streakText(); $("gm-win-run").textContent = run; $("gm-win-run").hidden = !run;
    var slot = $("gm-win-share"); slot.textContent = ""; slot.appendChild(shareButton(shareText));
    lastFocus = document.activeElement;
    var w = $("gm-win"); w.hidden = false;
    var f = w.querySelector(".gm-ferry"), nf = f.cloneNode(true); f.parentNode.replaceChild(nf, f);   // sail again
    confetti(); $("gm-win-ok").focus();
  }
  function closeWin() { $("gm-win").hidden = true; cancelAnimationFrame(raf); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $("gm-win-ok").addEventListener("click", closeWin);
  $("gm-win").addEventListener("click", function (e) { if (e.target === $("gm-win")) closeWin(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("gm-win").hidden) closeWin(); });

  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function waiting(stage, text) { var p = el("p", "gm-wait", text); stage.appendChild(p); return p; }

  /* ====================== CROSSWORD ====================== */
  var months = {};
  function crossword(level, stage) {
    var lv = level === "easy" ? "easy" : "cryptic", alive = true, inner = null, note = waiting(stage, "Fetching today’s crossword…");
    var month = ISO.slice(0, 7);
    (months[month] || (months[month] = getJSON("/assets/games/xw-" + month + ".json"))).then(function (data) {
      if (!alive) return; var P = data[ISO] && data[ISO][lv];
      if (!P) throw new Error("no puzzle");
      note.remove(); inner = buildCrossword(P, lv, stage);
    }).catch(function () { if (alive) note.textContent = "There is no crossword for today. That should not happen: please tell hello@largs.scot. The sudoku and Wee Wurd are still here."; });
    return { leave: function () { alive = false; if (inner) inner.leave(); } };
  }
  function buildCrossword(P, lv, stage) {
    var ROWS = P.rows, N = 9, KEY = PRE + "xw:" + ISO + ":" + lv, LABEL = "Largs crossword · " + (lv === "easy" ? "easy" : "cryptic");
    var open = function (r, c) { return r >= 0 && c >= 0 && r < N && c < N && ROWS[r][c] !== "#"; };
    var lay = el("div", "gm-layout"), board = el("div", "gboard"), cluesBox = el("div", "gm-clues");
    var nowBar = el("div", "gm-now"), nowN = el("span", "gm-now-n"), nowT = el("span", "gm-now-t"); nowBar.setAttribute("aria-live", "polite"); nowBar.append(nowN, nowT);
    var grid = el("div", "gm-grid"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Crossword grid, nine squares by nine");
    var tools = el("div", "gm-tools"), bCheck = el("button", "gm-main", "Check my answers"), bReveal = el("button", "", "Reveal this word"), bClear = el("button", "", "Clear all"), clockEl = el("span", "gm-clock");
    [bCheck, bReveal, bClear].forEach(function (b) { b.type = "button"; }); tools.append(bCheck, bReveal, bClear, clockEl);
    var status = el("div", "gm-status"); status.setAttribute("role", "status");
    var after = el("div", "gm-after");
    board.append(nowBar, grid, tools, status, after);
    var secA = el("section"), secD = el("section"), olA = el("ol"), olD = el("ol");
    secA.append(el("h2", "", "Across"), olA); secD.append(el("h2", "", "Down"), olD); cluesBox.append(secA, secD);
    lay.append(board, cluesBox); stage.appendChild(lay);
    var clock = Clock(KEY + ":t", clockEl);

    var num = {}, entries = [], n = 0, r, c;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      if (!open(r, c)) continue;
      var sa = !open(r, c - 1) && open(r, c + 1), sd = !open(r - 1, c) && open(r + 1, c);
      if (!sa && !sd) continue;
      n++; num[r + "," + c] = n; var k, cells;
      if (sa) { cells = []; for (k = c; open(r, k); k++) cells.push([r, k]); entries.push({ n: n, dir: "a", cells: cells }); }
      if (sd) { cells = []; for (k = r; open(k, c); k++) cells.push([k, c]); entries.push({ n: n, dir: "d", cells: cells }); }
    }
    function entryAt(r, c, dir) {
      for (var i = 0; i < entries.length; i++) { var e = entries[i]; if (e.dir !== dir) continue;
        for (var j = 0; j < e.cells.length; j++) if (e.cells[j][0] === r && e.cells[j][1] === c) return e; }
      return null;
    }
    var inputs = {}, first = null;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      if (!open(r, c)) { grid.appendChild(el("div", "gm-blk")); continue; }
      var d = el("div", "gm-cell");
      if (num[r + "," + c]) d.appendChild(el("span", "gm-num", num[r + "," + c]));
      var inp = el("input"); inp.type = "text"; inp.maxLength = 2; inp.autocomplete = "off"; inp.autocapitalize = "characters"; inp.spellcheck = false;
      inp.setAttribute("autocorrect", "off"); inp.setAttribute("aria-label", "Row " + (r + 1) + ", column " + (c + 1)); inp.dataset.r = r; inp.dataset.c = c;
      d.appendChild(inp); grid.appendChild(d); inputs[r + "," + c] = inp; if (!first && num[r + "," + c]) first = [r, c];
    }
    var clueEls = {};
    entries.forEach(function (e) {
      var li = el("li"); li.tabIndex = 0; li.setAttribute("role", "button");
      var wrap = el("span"); wrap.append(el("span", "gm-ct", P[e.dir][e.n]), " ", el("span", "gm-len", "(" + e.cells.length + ")"));
      li.append(el("span", "gm-cn", e.n), wrap);
      var go = function () { select(e.cells[0][0], e.cells[0][1], e.dir, true); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
      (e.dir === "a" ? olA : olD).appendChild(li); clueEls[e.dir + e.n] = li;
    });

    var sel = { r: first[0], c: first[1], dir: "a" }, helped = false;
    function val(r, c) { return inputs[r + "," + c].value.toUpperCase(); }
    function say(t, err) { status.textContent = t; status.className = "gm-status" + (err ? " gm-err" : ""); }
    function paint() {
      var cur = entryAt(sel.r, sel.c, sel.dir), k;
      for (k in inputs) inputs[k].parentNode.classList.remove("gm-hl", "gm-sel");
      if (cur) cur.cells.forEach(function (p) { inputs[p[0] + "," + p[1]].parentNode.classList.add("gm-hl"); });
      inputs[sel.r + "," + sel.c].parentNode.classList.add("gm-sel");
      for (k in clueEls) clueEls[k].classList.remove("gm-on");
      if (cur) { clueEls[cur.dir + cur.n].classList.add("gm-on"); nowN.textContent = cur.n + (cur.dir === "a" ? " across" : " down"); nowT.textContent = P[cur.dir][cur.n] + " (" + cur.cells.length + ")"; }
      entries.forEach(function (e) { clueEls[e.dir + e.n].classList.toggle("cdone", e.cells.every(function (p) { return val(p[0], p[1]) !== ""; })); });
    }
    function select(r, c, dir, focus) {
      if (!entryAt(r, c, dir)) dir = dir === "a" ? "d" : "a";
      sel = { r: r, c: c, dir: dir }; paint();
      if (focus) inputs[r + "," + c].focus({ preventScroll: true });
    }
    function step(delta) {
      var e = entryAt(sel.r, sel.c, sel.dir); if (!e) return;
      var i = e.cells.findIndex(function (p) { return p[0] === sel.r && p[1] === sel.c; }) + delta;
      if (i >= 0 && i < e.cells.length) select(e.cells[i][0], e.cells[i][1], sel.dir, true); else paint();
    }
    function save() { var o = {}, k; for (k in inputs) if (inputs[k].value) o[k] = inputs[k].value.toUpperCase(); store(KEY, { cells: o, helped: helped }); }
    function solved() { for (var k in inputs) { var p = k.split(","); if (val(+p[0], +p[1]) !== ROWS[+p[0]][+p[1]]) return false; } return true; }
    function shareText(secs) { return "Largs crossword (" + (lv === "easy" ? "easy" : "cryptic") + ") · " + TODAY.short + " · solved in " + words(secs) + (helped ? ", with a little help" : "") + "\n" + LINK; }
    function showDone(secs) { say("Solved in " + words(secs) + "."); after.textContent = ""; after.appendChild(shareButton(shareText(secs))); }
    function win() {
      var already = clock.done(), secs = clock.finish(); paint(); markPlayed(); showDone(secs);
      if (!already) celebrate(LABEL, "in " + words(secs), helped ? "With a little help from the reveal button." : "No help needed. Every square your own.", shareText(secs));
    }
    Object.keys(inputs).forEach(function (k) {
      var inp = inputs[k], r = +inp.dataset.r, c = +inp.dataset.c;
      inp.addEventListener("pointerdown", function () {
        if (sel.r === r && sel.c === c && document.activeElement === inp) { var other = sel.dir === "a" ? "d" : "a"; if (entryAt(r, c, other)) { sel.dir = other; paint(); } }
      });
      inp.addEventListener("focus", function () { if (sel.r !== r || sel.c !== c) select(r, c, sel.dir, false); else paint(); });
      inp.addEventListener("input", function () {
        var m = inp.value.replace(/[^a-zA-Z]/g, ""); inp.value = m ? m.slice(-1).toUpperCase() : "";
        inp.parentNode.classList.remove("gm-bad"); clock.start(); save(); say("");
        if (inp.value) { if (solved()) win(); else step(1); } else paint();
      });
      inp.addEventListener("keydown", function (ev) {
        var mv = { ArrowLeft: [0, -1, "a"], ArrowRight: [0, 1, "a"], ArrowUp: [-1, 0, "d"], ArrowDown: [1, 0, "d"] }[ev.key];
        if (mv) { ev.preventDefault(); var nr = r + mv[0], nc = c + mv[1];
          while (nr >= 0 && nc >= 0 && nr < N && nc < N && !open(nr, nc)) { nr += mv[0]; nc += mv[1]; }
          if (open(nr, nc)) select(nr, nc, mv[2], true); return; }
        if (ev.key === "Backspace" && inp.value === "") { ev.preventDefault(); step(-1); var b = inputs[sel.r + "," + sel.c]; b.value = ""; b.parentNode.classList.remove("gm-bad"); save(); paint(); }
      });
    });
    bCheck.addEventListener("click", function () {
      var wrong = 0, blank = 0, k;
      for (k in inputs) { var p = k.split(","), v = val(+p[0], +p[1]), bad = v !== "" && v !== ROWS[+p[0]][+p[1]]; inputs[k].parentNode.classList.toggle("gm-bad", bad); if (bad) wrong++; if (v === "") blank++; }
      if (!wrong && !blank) win();
      else if (!wrong) say("Nothing wrong so far. " + blank + " square" + (blank === 1 ? "" : "s") + " to go.");
      else say(wrong + " letter" + (wrong === 1 ? " is" : "s are") + " not right; " + (wrong === 1 ? "it is" : "they are") + " marked in red.", true);
    });
    bReveal.addEventListener("click", function () {
      var e = entryAt(sel.r, sel.c, sel.dir); if (!e || clock.done()) return;
      helped = true; clock.start();
      e.cells.forEach(function (p) { var i = inputs[p[0] + "," + p[1]]; i.value = ROWS[p[0]][p[1]]; i.parentNode.classList.remove("gm-bad"); });
      save(); say(""); if (solved()) win(); else paint();
    });
    bClear.addEventListener("click", function () { for (var k in inputs) { inputs[k].value = ""; inputs[k].parentNode.classList.remove("gm-bad"); } helped = false; clock.reset(); save(); after.textContent = ""; paint(); say(""); });

    var saved = load(KEY);
    if (saved && saved.cells) { for (var sk in saved.cells) if (inputs[sk]) inputs[sk].value = String(saved.cells[sk]).slice(0, 1); helped = !!saved.helped; }
    select(sel.r, sel.c, "a", false);
    if (clock.done()) showDone(clock.seconds());
    return { leave: function () { clock.pause(); } };
  }

  /* ====================== SUDOKU ====================== */
  function rng(seedText) { // small seeded generator: the same date gives the same result to everyone
    var h = 1779033703 ^ seedText.length, i;
    for (i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    var a = (h ^ h >>> 16) >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(a, rand) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function box(i) { return Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3); }
  function countSolutions(g, limit, rand, keep) { // bitmask search, most-constrained square first
    var rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0), i, found = 0;
    for (i = 0; i < 81; i++) if (g[i]) { var b = 1 << g[i]; rows[Math.floor(i / 9)] |= b; cols[i % 9] |= b; boxes[box(i)] |= b; }
    (function go() {
      var best = -1, bestN = 10, bestMask = 0, i, v;
      for (i = 0; i < 81; i++) if (!g[i]) {
        var m = ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)]) & 0x3FE, cnt = 0, x = m;
        while (x) { x &= x - 1; cnt++; }
        if (cnt < bestN) { bestN = cnt; best = i; bestMask = m; if (cnt <= 1) break; }
      }
      if (best < 0) { found++; return; }
      if (!bestN) return;
      var opts = []; for (v = 1; v <= 9; v++) if (bestMask & 1 << v) opts.push(v);
      if (rand) shuffle(opts, rand);
      for (var k = 0; k < opts.length && found < limit; k++) {
        v = opts[k]; var bit = 1 << v, r = Math.floor(best / 9), c = best % 9, bx = box(best);
        g[best] = v; rows[r] |= bit; cols[c] |= bit; boxes[bx] |= bit;
        go();
        if (found >= limit && keep) return;
        g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[bx] &= ~bit;
      }
    })();
    return found;
  }
  function makeSudoku(seedText, givens) {
    var rand = rng(seedText), sol = new Array(81).fill(0);
    countSolutions(sol, 1, rand, true);                 // a full, valid grid
    var puz = sol.slice(), order = shuffle(Array.from({ length: 81 }, function (_, i) { return i; }), rand), left = 81;
    for (var k = 0; k < 81 && left > givens; k++) {   // take squares away while one answer remains
      var i = order[k], was = puz[i]; puz[i] = 0;
      if (countSolutions(puz.slice(), 2) === 1) left--; else puz[i] = was;
    }
    return { sol: sol, puz: puz, left: left };
  }

  function sudoku(level, stage) {
    var S = makeSudoku(ISO + "-" + level, level === "easy" ? 40 : 27), KEY = PRE + "sd:" + ISO + ":" + level, NAME = level === "easy" ? "easy" : "harder";
    var lay = el("div", "gm-layout"), board = el("div", "gboard"), side = el("div", "gm-blurb");
    var grid = el("div", "gm-sd"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Sudoku grid");
    var pad = el("div", "gm-pad"), tools = el("div", "gm-tools"), bCheck = el("button", "gm-main", "Check my answers"), bClear = el("button", "", "Start again"), clockEl = el("span", "gm-clock");
    bCheck.type = bClear.type = "button"; tools.append(bCheck, bClear, clockEl);
    var status = el("div", "gm-status"); status.setAttribute("role", "status");
    var after = el("div", "gm-after");
    board.append(grid, pad, tools, status, after);
    side.append(el("h2", "", "Today’s sudoku · " + NAME));
    side.append(el("p", "", "Fill the grid so that every row, every column and every box of nine holds the numbers 1 to 9 once each."));
    side.append(el("p", "", "Tap a square, then a number. This grid starts with " + S.left + " numbers filled in; it has exactly one solution, and it is the same grid for everyone today."));
    lay.append(board, side); stage.appendChild(lay);
    var clock = Clock(KEY + ":t", clockEl);

    var vals = S.puz.slice(), cells = [], sel = -1, i;
    var saved = load(KEY); if (saved && saved.length === 81) for (i = 0; i < 81; i++) if (!S.puz[i]) vals[i] = saved[i] | 0;
    function say(t, err) { status.textContent = t; status.className = "gm-status" + (err ? " gm-err" : ""); }
    function shareText(secs) { return "Largs sudoku (" + NAME + ") · " + TODAY.short + " · solved in " + words(secs) + "\n" + LINK; }
    function showDone(secs) { say("Solved in " + words(secs) + "."); after.textContent = ""; after.appendChild(shareButton(shareText(secs))); }
    function paint() {
      var counts = new Array(10).fill(0);
      for (var i = 0; i < 81; i++) {
        var b = cells[i]; b.textContent = vals[i] || ""; counts[vals[i]]++;
        b.classList.toggle("gm-sel", i === sel);
        b.classList.toggle("gm-peer", sel >= 0 && i !== sel && (Math.floor(i / 9) === Math.floor(sel / 9) || i % 9 === sel % 9 || box(i) === box(sel)));
        b.classList.toggle("gm-same", sel >= 0 && i !== sel && !!vals[sel] && vals[i] === vals[sel]);
        b.setAttribute("aria-label", "Row " + (Math.floor(i / 9) + 1) + ", column " + (i % 9 + 1) + ", " + (vals[i] ? vals[i] + (S.puz[i] ? ", given" : "") : "empty"));
      }
      padBtns.forEach(function (p, k) { var v = k + 1, left = 9 - counts[v]; p.classList.toggle("gm-used", left <= 0); p.querySelector(".gm-left").textContent = left > 0 ? left + " left" : "done"; });
    }
    function put(v) {
      if (sel < 0 || S.puz[sel] || clock.done()) return;
      vals[sel] = vals[sel] === v ? 0 : v; cells[sel].classList.remove("gm-bad");
      clock.start(); store(KEY, vals); say(""); paint();
      for (var i = 0; i < 81; i++) if (vals[i] !== S.sol[i]) return;
      var secs = clock.finish(); markPlayed(); showDone(secs);
      celebrate("Sudoku · " + DAY + " · " + NAME, "in " + words(secs), "Come back tomorrow for a new one.", shareText(secs));
    }
    for (i = 0; i < 81; i++) (function (i) {
      var b = el("button", "gm-sd-cell" + (S.puz[i] ? " gm-given" : "") + (i % 9 === 2 || i % 9 === 5 ? " gm-bx-r" : "") + (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5 ? " gm-bx-b" : "")); b.type = "button";
      b.addEventListener("click", function () { sel = i; paint(); });
      b.addEventListener("keydown", function (ev) {
        if (/^[1-9]$/.test(ev.key)) { sel = i; put(+ev.key); return; }
        if (ev.key === "Backspace" || ev.key === "Delete" || ev.key === "0") { sel = i; if (!S.puz[i] && vals[i]) put(vals[i]); return; }
        var mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[ev.key];
        if (mv) { ev.preventDefault(); var j = i + mv; if (j >= 0 && j < 81 && !(Math.abs(mv) === 1 && Math.floor(j / 9) !== Math.floor(i / 9))) { sel = j; paint(); cells[j].focus(); } }
      });
      grid.appendChild(b); cells.push(b);
    })(i);
    var padBtns = [];
    for (var v = 1; v <= 9; v++) (function (v) {
      var p = el("button"); p.type = "button"; p.append(String(v), el("span", "gm-left", "")); p.setAttribute("aria-label", "Enter " + v);
      p.addEventListener("click", function () { put(v); }); pad.appendChild(p); padBtns.push(p);
    })(v);
    var er = el("button", "gm-erase", "Erase"); er.type = "button"; er.addEventListener("click", function () { if (sel >= 0 && !S.puz[sel] && vals[sel]) put(vals[sel]); }); pad.appendChild(er);
    bCheck.addEventListener("click", function () {
      var wrong = 0, blank = 0;
      for (var i = 0; i < 81; i++) { var bad = vals[i] && vals[i] !== S.sol[i]; cells[i].classList.toggle("gm-bad", !!bad); if (bad) wrong++; if (!vals[i]) blank++; }
      if (wrong) say(wrong + " number" + (wrong === 1 ? " is" : "s are") + " not right; " + (wrong === 1 ? "it is" : "they are") + " underlined in red.", true);
      else if (blank) say("Nothing wrong so far. " + blank + " square" + (blank === 1 ? "" : "s") + " to go.");
    });
    bClear.addEventListener("click", function () { vals = S.puz.slice(); cells.forEach(function (c) { c.classList.remove("gm-bad"); }); sel = -1; clock.reset(); store(KEY, vals); after.textContent = ""; say(""); paint(); });
    paint();
    if (clock.done()) showDone(clock.seconds());
    return { leave: function () { clock.pause(); } };
  }

  /* ====================== WEE WURD ====================== */
  var wurdData = null, guessList = null;
  function wurdOfTheDay(list, level) {      // each list is dealt out in a shuffled order, start to finish, before any word comes round again
    var n = list.length, cycle = Math.floor(TODAY.num / n), order = shuffle(list.map(function (_, i) { return i; }), rng("wee-wurd-" + level + "-" + cycle));
    return list[order[TODAY.num % n]];
  }
  function isWord(w) {                      // the accepted guesses are one long sorted string of five-letter words
    if (!guessList) return true; var lo = 0, hi = guessList.length / 5 - 1; w = w.toLowerCase();
    while (lo <= hi) { var mid = (lo + hi) >> 1, s = guessList.substr(mid * 5, 5); if (s === w) return true; if (s < w) lo = mid + 1; else hi = mid - 1; }
    return false;
  }
  function wurd(level, stage) {
    var alive = true, inner = null, note = waiting(stage, "Fetching today’s Wee Wurd…");
    wurdData = wurdData || Promise.all([getJSON("/assets/games/wurd.json"),
      fetch("/assets/games/wurd-guesses.txt").then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; })]);
    wurdData.then(function (got) {
      if (!alive) return; if (got[1] && got[1].length % 5 === 0) guessList = got[1];
      note.remove(); inner = buildWurd(got[0], level, stage);
    }).catch(function () { wurdData = null; if (alive) note.textContent = "Wee Wurd could not be fetched. Check your connection and try again."; });
    return { leave: function () { alive = false; if (inner) inner.leave(); } };
  }
  function buildWurd(data, level, stage) {
    var scots = level === "hard", pick = wurdOfTheDay(scots ? data.scottish : data.english, level), NAME = scots ? "Scottish" : "English";
    var ANSWER = scots ? pick[0] : pick, GLOSS = scots ? pick[1] : "", KEY = PRE + "wd:" + ISO + ":" + level;
    var lay = el("div", "gm-layout"), board = el("div", "gboard"), side = el("div", "gm-blurb");
    var grid = el("div", "gm-wd"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Six guesses of five letters");
    var kb = el("div", "gm-kb"), tools = el("div", "gm-tools"), clockEl = el("span", "gm-clock"); tools.append(clockEl);
    var status = el("div", "gm-status"); status.setAttribute("role", "status");
    var gloss = el("div", "gm-gloss"), after = el("div", "gm-after");
    board.append(grid, status, gloss, after, kb, tools);
    side.append(el("h2", "", "Today’s Wee Wurd · " + NAME));
    side.append(el("p", "", "Find the five-letter word in six goes. Type a word with the keys under the grid, or your own keyboard, and press Enter; each letter then tells you how close you were."));
    [["hit", "F", "in the word and in the right place"], ["gm-near", "E", "in the word, but somewhere else"], ["gm-no", "Y", "not in the word at all"]].forEach(function (e) {
      var row = el("div", "gm-eg"); row.append(el("span", "wtile " + e[0], e[1]), el("span", "", e[2])); side.append(row);
    });
    side.append(el("p", "", scots ? "Today’s Scottish one is something from the hills, the kitchen, the history books or the Scots tongue. Never a place name." : "Today’s English one is an everyday word, in British spelling. Never a name."));
    lay.append(board, side); stage.appendChild(lay);
    var clock = Clock(KEY + ":t", clockEl);

    var tiles = [], rowsEl = [], r, c;
    for (r = 0; r < 6; r++) { var rowEl = el("div", "gm-wd-row"); tiles.push([]); for (c = 0; c < 5; c++) { var t = el("div", "wtile"); rowEl.appendChild(t); tiles[r].push(t); } grid.appendChild(rowEl); rowsEl.push(rowEl); }
    var keys = {};
    ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"].forEach(function (line) {
      var rowEl = el("div", "gm-kb-row");
      line.split("").forEach(function (ch) {
        var b = el("button", ch === "+" ? "gm-wide gm-enter" : ch === "-" ? "gm-wide" : "", ch === "+" ? "Enter" : ch === "-" ? "⌫" : ch); b.type = "button";
        if (ch === "-") b.setAttribute("aria-label", "Delete");
        b.addEventListener("click", function () { press(ch === "+" ? "Enter" : ch === "-" ? "Backspace" : ch); });
        rowEl.appendChild(b); if (ch !== "+" && ch !== "-") keys[ch] = b;
      });
      kb.appendChild(rowEl);
    });

    var guesses = [], cur = "", over = false;
    function say(t, err) { status.textContent = t; status.className = "gm-status" + (err ? " gm-err" : ""); }
    function score(g) { // right place first, then right letter elsewhere, counting each letter of the answer once
      var res = ["gm-no", "gm-no", "gm-no", "gm-no", "gm-no"], left = {}, i;
      for (i = 0; i < 5; i++) { if (g[i] === ANSWER[i]) res[i] = "hit"; else left[ANSWER[i]] = (left[ANSWER[i]] || 0) + 1; }
      for (i = 0; i < 5; i++) if (res[i] !== "hit" && left[g[i]]) { res[i] = "gm-near"; left[g[i]]--; }
      return res;
    }
    var RANK = { "gm-no": 1, "gm-near": 2, "hit": 3 }, SAID = { "hit": "right place", "gm-near": "wrong place", "gm-no": "not in the word" }, SQUARE = { "hit": "🟩", "gm-near": "🟨", "gm-no": "⬜" };
    function paintRow(r, animate) {
      var g = guesses[r], res = score(g);
      for (var c = 0; c < 5; c++) (function (c) {
        var t = tiles[r][c]; t.textContent = g[c]; t.className = "wtile gm-filled " + res[c] + (animate ? " gm-flip" : "");
        if (animate) t.style.animationDelay = (c * 0.12) + "s";
        t.setAttribute("aria-label", g[c] + ", " + SAID[res[c]]);
        var k = keys[g[c]], had = k.dataset.s; if (!had || RANK[res[c]] > RANK[had]) { k.dataset.s = res[c]; k.classList.remove("hit", "gm-near", "gm-no"); k.classList.add(res[c]); }
      })(c);
    }
    function paintCur() { if (guesses.length > 5) return; for (var c = 0; c < 5; c++) { var t = tiles[guesses.length][c]; t.textContent = cur[c] || ""; t.className = "wtile" + (cur[c] ? " gm-filled" : ""); } }
    function shareText(won) {
      return "Wee Wurd (" + NAME + ") · " + TODAY.short + " · " + (won ? guesses.length : "X") + "/6\n" +
        guesses.map(function (g) { return score(g).map(function (s) { return SQUARE[s]; }).join(""); }).join("\n") + "\n" + LINK;
    }
    function finish(won, fresh) {
      over = true;
      var secs = clock.finish(), n = guesses.length, goes = n + (n === 1 ? " go" : " goes"); markPlayed();
      if (won) say("Got it in " + goes + "."); else say("The word was " + ANSWER + ". A new one tomorrow morning.", true);
      if (GLOSS) gloss.textContent = ANSWER.charAt(0) + ANSWER.slice(1).toLowerCase() + ": " + GLOSS + ".";
      after.textContent = ""; after.appendChild(shareButton(shareText(won)));
      if (won && fresh) setTimeout(function () { celebrate("Wee Wurd · " + NAME + " · " + DAY, "in " + goes + " out of six", GLOSS ? ANSWER + ": " + GLOSS + "." : "Time taken: " + words(secs) + ".", shareText(true)); }, 900);
    }
    function shake() { var rw = rowsEl[guesses.length]; rw.classList.remove("gm-shake"); void rw.offsetWidth; rw.classList.add("gm-shake"); }
    function press(k) {
      if (over) return;
      if (k === "Backspace") { cur = cur.slice(0, -1); paintCur(); say(""); return; }
      if (k === "Enter") {
        if (cur.length < 5) { say("Five letters, please.", true); shake(); return; }
        if (cur !== ANSWER && !isWord(cur)) { say(cur + " is not a word we know.", true); shake(); return; }
        guesses.push(cur); cur = ""; clock.start(); store(KEY, guesses); paintRow(guesses.length - 1, true); say("");
        if (guesses[guesses.length - 1] === ANSWER) finish(true, true); else if (guesses.length === 6) finish(false, true);
        return;
      }
      if (/^[A-Z]$/.test(k) && cur.length < 5) { cur += k; paintCur(); say(""); }
    }
    function onKey(ev) {
      if (!$("gm-win").hidden || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var t = ev.target, k = ev.key === "Enter" || ev.key === "Backspace" ? ev.key : (ev.key.length === 1 ? ev.key.toUpperCase() : "");
      if (t && t.closest && (t.closest("input, textarea, a") || (k === "Enter" && t.closest("button") && !t.closest(".gm-kb")))) return; // leave links, boxes and other buttons alone
      if (k === "Enter" || k === "Backspace" || /^[A-Z]$/.test(k)) { ev.preventDefault(); press(k); }
    }
    document.addEventListener("keydown", onKey);
    var ae = document.activeElement; if (ae && ae.blur && ae.closest && ae.closest(".gm-games, .gm-seg")) ae.blur();   // so Enter submits a guess straight after choosing the game

    var saved = load(KEY);
    if (Array.isArray(saved)) saved.slice(0, 6).forEach(function (g) { if (/^[A-Z]{5}$/.test(g)) { guesses.push(g); paintRow(guesses.length - 1, false); } });
    if (guesses.length && guesses[guesses.length - 1] === ANSWER) finish(true, false); else if (guesses.length === 6) finish(false, false);
    return { leave: function () { clock.pause(); document.removeEventListener("keydown", onKey); } };
  }

  /* ---------- which one is showing ---------- */
  var GAMES = { crossword: crossword, sudoku: sudoku, "wee-wurd": wurd };
  var LEVELS = { crossword: ["Easy", "Cryptic"], sudoku: ["Easy", "Harder"], "wee-wurd": ["English", "Scottish"] };
  var TODAYLINE = { crossword: "two new crosswords every morning at six", sudoku: "two new grids every morning at six", "wee-wurd": "two new words every morning at six" };
  var pref = load(PRE + "last") || {}, fromHash = location.hash.slice(1);
  var state = { game: GAMES[fromHash] ? fromHash : (GAMES[pref.game] ? pref.game : "crossword"), level: pref.level === "hard" ? "hard" : "easy" }, current = null;
  var gameBtns = root.querySelectorAll("[data-game]"), levelBtns = root.querySelectorAll("[data-level]");
  function show() {
    if (current) current.leave();
    var stage = $("gm-stage"); stage.textContent = "";
    current = GAMES[state.game](state.level, stage);
    $("gm-today").textContent = DAY + " · " + TODAYLINE[state.game];
    gameBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.game === state.game)); });
    levelBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.level === state.level)); b.textContent = LEVELS[state.game][b.dataset.level === "easy" ? 0 : 1]; });
    store(PRE + "last", state);
    // The address is deliberately NOT rewritten here (22 Nov 2026): analytics counts a
    // page changing its own address as a new page view, which inflated the Games figures.
    // A link such as /games/#sudoku still opens the right game; see fromHash above.
    var rep = $("gm-report"); if (rep) rep.href = "mailto:hello@largs.scot?subject=" + encodeURIComponent("Games: " + state.game + " (" + LEVELS[state.game][state.level === "easy" ? 0 : 1] + "), " + ISO);
  }
  gameBtns.forEach(function (b) { b.addEventListener("click", function () { state.game = b.dataset.game; show(); }); });
  levelBtns.forEach(function (b) { b.addEventListener("click", function () { state.level = b.dataset.level; show(); }); });
  window.addEventListener("hashchange", function () { var h = location.hash.slice(1); if (GAMES[h] && h !== state.game) { state.game = h; show(); } });
  root.classList.add("gm-ready");
  showStreak(); show();
})();
