#!/usr/bin/env node
/* Games page data (21 Nov 2026). Run from the repo root.

     node scripts/make-games.mjs check                 check the clue bank only
     node scripts/make-games.mjs crosswords 2027-11-30 build crosswords up to that date
     node scripts/make-games.mjs wurd                  build the Wee Wurd lists

   CROSSWORDS. data/games/clue-bank.txt holds every answer with a plain clue,
   a cryptic clue and a check code. This script verifies the bank, finds
   9x9 grid shapes, fills one grid per day and level from the bank, and
   writes src/assets/games/xw-YYYY-MM.json. Nothing here calls a service.

   APPEND-ONLY. A day that already has a puzzle is never rebuilt: someone may
   be half way through it. The script reads the existing files, remembers
   which answers were used when, and carries on from the day after the last
   one. To add clues, add lines to the bank and run "crosswords" with a later
   date. It refuses rather than guesses if the bank fails a check.

   WEE WURD. data/games/wurd-english.txt and wurd-scottish.txt are the answer
   lists. The accepted guesses are every five-letter word in the word list
   at .cache/words/package/index.json (npm: an-array-of-english-words, MIT;
   its licence is copied beside the output). */
import fs from "node:fs";
import path from "node:path";

const refuse = m => { console.error("REFUSED: " + m); process.exit(1); };
const BANK = "data/games/clue-bank.txt", OUT = "src/assets/games";
const [mode, arg] = process.argv.slice(2);
if (!["check", "crosswords", "wurd"].includes(mode)) refuse("say what to build: check, crosswords <to-date>, or wurd");
if (!fs.existsSync("eleventy.config.js")) refuse("run this from the repo root");

function rng(seedText) { let h = 1779033703 ^ seedText.length; for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = (h ^ h >>> 16) >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- Wee Wurd ---------------- */
if (mode === "wurd") {
  const SRC = ".cache/words/package/index.json";
  if (!fs.existsSync(SRC)) refuse("word list missing: " + SRC + " (see the note at the top of this file)");
  const all = JSON.parse(fs.readFileSync(SRC, "utf8")), known = new Set(all);
  const english = fs.readFileSync("data/games/wurd-english.txt", "utf8").split(/\s+/).filter(Boolean);
  const scottish = fs.readFileSync("data/games/wurd-scottish.txt", "utf8").split("\n").filter(l => l.trim()).map(l => l.split("|"));
  const AMERICAN = "color fiber liter favor honor labor meter rumor tumor vapor armor humor savor valor vigor rigor odor center theater".toUpperCase().split(" ");
  const seen = new Set();
  for (const w of [...english, ...scottish.map(s => s[0])]) {
    if (!/^[A-Z]{5}$/.test(w)) refuse("not five capital letters: " + w);
    if (seen.has(w)) refuse("listed twice: " + w); seen.add(w);
    if (AMERICAN.includes(w)) refuse("American spelling as an answer: " + w);
  }
  for (const w of english) if (!known.has(w.toLowerCase())) refuse("English answer not in the word list: " + w);
  for (const s of scottish) if (s.length !== 2 || !s[1].trim()) refuse("Scottish word needs a meaning: " + s[0]);
  const guesses = [...new Set([...all.filter(w => /^[a-z]{5}$/.test(w)), ...[...seen].map(w => w.toLowerCase())])].sort();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "wurd.json"), JSON.stringify({ english, scottish }) + "\n");
  fs.writeFileSync(path.join(OUT, "wurd-guesses.txt"), guesses.join(""));
  fs.copyFileSync(".cache/words/package/license", path.join(OUT, "WORD-LIST-LICENCE.txt"));
  console.log(`OK: Wee Wurd: ${english.length} English answers, ${scottish.length} Scottish, ${guesses.length} accepted guesses`);
  process.exit(0);
}

/* ---------------- the clue bank ---------------- */
if (!fs.existsSync(BANK)) refuse("clue bank missing: " + BANK);
const L = s => s.toLowerCase().replace(/[^a-z]/g, ""), sorted = s => [...s].sort().join("");
const bank = new Map(), problems = [];
for (const line of fs.readFileSync(BANK, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const f = line.split("|"); if (f.length !== 4) { problems.push("needs four fields: " + line); continue; }
  const [word, plain, cryptic, check] = f, w = word.toLowerCase(), bad = m => problems.push(word + ": " + m);
  if (!/^[A-Z]{3,9}$/.test(word)) bad("answer must be 3 to 9 capital letters");
  if (bank.has(word)) bad("listed twice");
  for (const c of [plain, cryptic]) if (c.toLowerCase().split(/[^a-z]+/).includes(w)) bad("the answer appears in its own clue: " + c);
  const kind = check[0], a = check.slice(2), inClue = () => L(cryptic).includes(L(a)) || bad("the letters to use are not in the clue");
  if (kind === "A") { if (sorted(L(a)) !== sorted(w)) bad("anagram letters do not match"); if (L(a) === w) bad("anagram of itself"); inClue(); }
  else if (kind === "H") { if (!L(a).includes(w)) bad("not hidden in the phrase"); if (a.toLowerCase().split(/[^a-z]+/).includes(w)) bad("hidden as a whole word"); inClue(); }
  else if (kind === "R") { if ([...L(a)].reverse().join("") !== w) bad("reversal does not match"); inClue(); }
  else if (kind === "I") { if (a.split(/\s+/).map(x => L(x)[0]).join("") !== w) bad("first letters do not match"); inClue(); }
  else if (kind === "C") { if (a.replace(/\+/g, "") !== word) bad("the parts do not join into the answer"); }
  else if (kind === "P") { if ([...w].reverse().join("") !== w) bad("not a palindrome"); }
  else if (!"DSX".includes(kind) || check.length !== 1) bad("unknown check code: " + check);
  bank.set(word, { plain, cryptic });
}
if (problems.length) { problems.forEach(p => console.error("  " + p)); refuse(problems.length + " problem(s) in the clue bank"); }
const byLen = {}; for (const w of bank.keys()) (byLen[w.length] ||= []).push(w);
const LENS = new Set(Object.keys(byLen).map(Number));
console.log("clue bank: " + bank.size + " answers, " + Object.entries(byLen).map(([k, v]) => v.length + " of " + k).join(", "));
if (mode === "check") process.exit(0);

/* ---------------- grids ---------------- */
if (!/^\d{4}-\d\d-\d\d$/.test(arg || "")) refuse("give the last date to build, as YYYY-MM-DD");
function slots(p) { const out = [], open = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9 && p[r][c] !== "#";
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { if (!open(r, c)) continue;
    if (!open(r, c - 1) && open(r, c + 1)) { const cells = []; for (let k = c; open(r, k); k++) cells.push(r * 9 + k); out.push({ dir: "a", cells }); }
    if (!open(r - 1, c) && open(r + 1, c)) { const cells = []; for (let k = r; open(k, c); k++) cells.push(k * 9 + c); out.push({ dir: "d", cells }); } }
  return out; }
const NEED = { 3: 1, 4: 2, 5: 2, 7: 3, 9: 4 };       // crossing letters an entry of each length must have
function validPattern(p) {
  const S = slots(p).map(s => s.cells); if (S.length < 14 || S.length > 20) return null;
  if (S.some(s => !LENS.has(s.length) || !NEED[s.length])) return null;
  const inWord = new Set(S.flat()); let cells = 0, first = -1;
  for (let i = 0; i < 81; i++) if (p[Math.floor(i / 9)][i % 9] === "1") { cells++; if (first < 0) first = i; if (!inWord.has(i)) return null; }
  if (cells < 49) return null;
  const seen = new Set([first]), q = [first];
  while (q.length) { const i = q.pop(), r = Math.floor(i / 9), c = i % 9; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const R = r + dr, C = c + dc, j = R * 9 + C;
    if (R >= 0 && C >= 0 && R < 9 && C < 9 && p[R][C] === "1" && !seen.has(j)) { seen.add(j); q.push(j); } } }
  if (seen.size !== cells) return null;
  const crossed = new Map(); S.forEach(s => s.forEach(c => crossed.set(c, (crossed.get(c) || 0) + 1)));
  if (S.some(s => s.filter(c => crossed.get(c) > 1).length < NEED[s.length])) return null;
  if (S.filter(s => s.length === 9).length > 2) return null;
  if (p.some(r => !r.includes("1")) || p.some((_, c) => p.every(r => r[c] === "#"))) return null;
  return { p, lens: S.map(s => s.length).sort().join(""), n: S.length, sevens: S.filter(s => s.length === 7).length, nines: S.filter(s => s.length === 9).length, threes: S.filter(s => s.length === 3).length };
}
const prand = rng("largs-patterns-1"), found = new Map();
for (let t = 0; t < 400000 && found.size < 4000; t++) {
  const g = Array.from({ length: 9 }, () => new Array(9).fill("#"));
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { if (r * 9 + c > 40) continue; if (r % 2 && c % 2) continue;
    const v = prand() < (r % 2 || c % 2 ? 0.72 : 0.93) ? "1" : "#"; g[r][c] = v; g[8 - r][8 - c] = v; }
  const p = g.map(r => r.join("")), v = validPattern(p); if (v && !found.has(p.join("/"))) found.set(p.join("/"), v);
}
const perSig = {};
const pats = [...found.values()].filter(v => v.threes <= 8 && (v.sevens >= 2 || v.nines >= 1)).sort((a, b) => b.n - a.n).filter(v => (perSig[v.lens] = (perSig[v.lens] || 0) + 1) <= 2);

function fill(pattern, rand, order, banned) {
  const S = slots(pattern).map(s => s.cells).sort((a, b) => b.length - a.length), grid = new Array(81).fill(""), used = new Set(); let steps = 0;
  const cand = s => byLen[s.length].filter(w => !used.has(w) && !banned.has(w) && s.every((cell, i) => !grid[cell] || grid[cell] === w[i]));
  function go() {
    if (++steps > 4000) return false;
    let best = null, bestC = null;
    for (const s of S) { if (s.every(c => grid[c])) continue; const c = cand(s); if (!bestC || c.length < bestC.length) { best = s; bestC = c; if (!c.length) return false; } }
    if (!best) return true;
    const key = new Map(bestC.map(w => [w, order(w) + rand() * 3])); bestC.sort((a, b) => key.get(a) - key.get(b));
    for (const w of bestC.slice(0, 12)) { const set = []; best.forEach((cell, i) => { if (!grid[cell]) { grid[cell] = w[i]; set.push(cell); } }); used.add(w);
      if (go()) return true; used.delete(w); set.forEach(c => grid[c] = ""); }
    return false;
  }
  if (!go()) return null;
  const words = S.map(s => s.map(c => grid[c]).join(""));
  if (words.some(w => !bank.has(w)) || new Set(words).size !== words.length) return null;
  return { rows: pattern.map((row, r) => [...row].map((ch, c) => ch === "1" ? grid[r * 9 + c] : "#").join("")), words };
}
const trial = rng("trial"), good = [];
for (const v of pats) { let ok = 0; for (let k = 0; k < 6; k++) if (fill(v.p, trial, () => 0, new Set())) ok++; if (ok >= 5) good.push(v.p); }
if (good.length < 40) refuse("only " + good.length + " grid shapes fill reliably; the bank is too thin somewhere");
console.log("grid shapes that fill reliably: " + good.length);

/* ---------------- what already exists ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const months = {}, LEVELS = ["easy", "cryptic"];
for (const f of fs.readdirSync(OUT).filter(f => /^xw-\d{4}-\d\d\.json$/.test(f)).sort()) months[f.slice(3, 10)] = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
const lastUsed = {}; let n = 0, lastDay = null;
const wordsOf = rows => slots(rows).map(s => s.cells.map(c => rows[Math.floor(c / 9)][c % 9]).join(""));
for (const m of Object.keys(months).sort()) for (const iso of Object.keys(months[m]).sort()) { lastDay = iso;
  for (const level of LEVELS) { n++; if (months[m][iso][level]) wordsOf(months[m][iso][level].rows).forEach(w => lastUsed[w] = n); } }
const DAY = 864e5, toMs = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)), toIso = ms => new Date(ms).toISOString().slice(0, 10);
const startMs = lastDay ? toMs(lastDay) + DAY : toMs(process.env.GAMES_START || toIso(Date.now() - DAY)), endMs = toMs(arg);
if (endMs < startMs) refuse("crosswords already exist up to " + lastDay + "; give a later date");
if ((endMs - startMs) / DAY > 800) refuse("that is more than two years in one go");

function clued(rows, level) {
  const out = { rows, a: {}, d: {} }, open = (r, c) => r >= 0 && c >= 0 && r < 9 && c < 9 && rows[r][c] !== "#"; let num = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { if (!open(r, c)) continue;
    const sa = !open(r, c - 1) && open(r, c + 1), sd = !open(r - 1, c) && open(r + 1, c); if (!sa && !sd) continue; num++;
    if (sa) { let w = ""; for (let k = c; open(r, k); k++) w += rows[r][k]; out.a[num] = bank.get(w)[level === "easy" ? "plain" : "cryptic"]; }
    if (sd) { let w = ""; for (let k = r; open(k, c); k++) w += rows[k][c]; out.d[num] = bank.get(w)[level === "easy" ? "plain" : "cryptic"]; } }
  return out;
}
const KEEP_APART = 16; let built = 0; const gaps = [], touched = new Set();
for (let ms = startMs; ms <= endMs; ms += DAY) { const iso = toIso(ms), m = iso.slice(0, 7);
  for (const level of LEVELS) { n++;
    const rand = rng(iso + level), order = w => lastUsed[w] === undefined ? 0 : 200 / (n - lastUsed[w]);
    let res = null, bestScore = Infinity;
    for (const ban of [KEEP_APART, 8, 2]) { const banned = new Set(Object.keys(lastUsed).filter(w => n - lastUsed[w] <= ban));
      for (let k = 0; k < 12; k++) { const r = fill(good[Math.floor(rand() * good.length)], rand, order, banned); if (!r) continue;
        const sc = r.words.reduce((t, w) => t + order(w), 0); if (sc < bestScore) { bestScore = sc; res = r; } }
      if (res) break; }
    if (!res) refuse("could not build " + iso + " " + level + "; nothing was written");
    res.words.forEach(w => { if (lastUsed[w] !== undefined) gaps.push(n - lastUsed[w]); lastUsed[w] = n; });
    ((months[m] ||= {})[iso] ||= {})[level] = clued(res.rows, level); touched.add(m); built++;
  } }
for (const m of touched) fs.writeFileSync(path.join(OUT, "xw-" + m + ".json"), JSON.stringify(months[m]) + "\n");
gaps.sort((a, b) => a - b);
console.log(`OK: built ${built} crosswords, ${toIso(startMs)} to ${arg}, in ${touched.size} monthly files` + (gaps.length ? `; an answer returns after ${gaps[0]} puzzles at the soonest, ${gaps[gaps.length >> 1]} typically` : ""));
