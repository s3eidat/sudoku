/* Sudoku — bitmask solver (constraint propagation + MRV backtracking), unique-solution generator, local save. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "sudoku.v1";
  var ROW = [], COL = [], BOX = [], PEERS = [];
  for (var i = 0; i < 81; i++) { ROW[i] = Math.floor(i / 9); COL[i] = i % 9; BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3); }
  for (i = 0; i < 81; i++) { PEERS[i] = []; for (var j = 0; j < 81; j++) if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) PEERS[i].push(j); }
  var ALL = 0x3FE; // bits 1..9
  function bits(m) { var c = 0; while (m) { m &= m - 1; c++; } return c; }
  function digitsOf(m) { var a = []; for (var d = 1; d <= 9; d++) if (m & (1 << d)) a.push(d); return a; }

  // ---------- solver (tested) ----------
  // Counts solutions up to `limit`; the first one found is written into `out` (if given). Returns 0 for an invalid grid.
  function solve(grid, limit, out, rnd) {
    var g = grid.slice(), r = new Array(9).fill(0), c = new Array(9).fill(0), b = new Array(9).fill(0), count = 0;
    for (var k = 0; k < 81; k++) {
      var v = g[k]; if (!v) continue;
      var bit = 1 << v;
      if ((r[ROW[k]] | c[COL[k]] | b[BOX[k]]) & bit) return 0;
      r[ROW[k]] |= bit; c[COL[k]] |= bit; b[BOX[k]] |= bit;
    }
    (function dfs() {
      // Most constrained empty cell first (MRV); a cell with no candidates prunes this branch at once.
      var best = -1, bestMask = 0, bestN = 10;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = ALL & ~(r[ROW[k]] | c[COL[k]] | b[BOX[k]]), n = bits(m);
        if (n < bestN) { best = k; bestMask = m; bestN = n; if (n <= 1) break; }
      }
      if (best < 0) { if (!count && out) for (var q = 0; q < 81; q++) out[q] = g[q]; count++; return; }
      if (!bestN) return;
      var ds = digitsOf(bestMask);
      if (rnd) for (var x = ds.length - 1; x > 0; x--) { var y = rnd(x + 1), t = ds[x]; ds[x] = ds[y]; ds[y] = t; }
      for (var di = 0; di < ds.length && count < limit; di++) {
        var bit = 1 << ds[di];
        g[best] = ds[di]; r[ROW[best]] |= bit; c[COL[best]] |= bit; b[BOX[best]] |= bit;
        dfs();
        g[best] = 0; r[ROW[best]] &= ~bit; c[COL[best]] &= ~bit; b[BOX[best]] &= ~bit;
      }
    })();
    return count;
  }
  function candidates(g, k) { var m = ALL; PEERS[k].forEach(function (p) { if (g[p]) m &= ~(1 << g[p]); }); return m; }
  // Can it be finished with naked and hidden singles only? (no guessing → easier puzzle)
  function singlesSolvable(grid) {
    var g = grid.slice(), progress = true;
    while (progress) {
      progress = false;
      for (var k = 0; k < 81; k++) {
        if (g[k]) continue;
        var m = candidates(g, k);
        if (!m) return false;
        if (bits(m) === 1) { g[k] = digitsOf(m)[0]; progress = true; }
      }
      for (var u = 0; u < 27; u++) {
        var cells = [];
        for (var q = 0; q < 81; q++) if ((u < 9 && ROW[q] === u) || (u >= 9 && u < 18 && COL[q] === u - 9) || (u >= 18 && BOX[q] === u - 18)) cells.push(q);
        for (var d = 1; d <= 9; d++) {
          var spots = cells.filter(function (q) { return !g[q] && (candidates(g, q) & (1 << d)); });
          var placed = cells.some(function (q) { return g[q] === d; });
          if (!placed && spots.length === 1) { g[spots[0]] = d; progress = true; }
        }
      }
    }
    return g.every(Boolean);
  }

  // ---------- generator (tested) ----------
  function cryptoRnd(n) { var a = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n; do { crypto.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; }
  var LEVELS = { easy: { clues: 38, singles: true }, medium: { clues: 31, singles: true }, hard: { clues: 26, singles: false }, expert: { clues: 22, singles: false } };
  function generate(level) {
    var L = LEVELS[level] || LEVELS.medium, sol = new Array(81).fill(0);
    solve(new Array(81).fill(0), 1, sol, cryptoRnd);
    var p = sol.slice(), clues = 81, order = [];
    for (var k = 0; k <= 40; k++) order.push(k);
    for (var x = order.length - 1; x > 0; x--) { var y = cryptoRnd(x + 1), t = order[x]; order[x] = order[y]; order[y] = t; }
    order.forEach(function (k) {
      if (clues <= L.clues) return;
      var pair = k === 40 ? [40] : [k, 80 - k], keep = pair.map(function (q) { return p[q]; });
      pair.forEach(function (q) { p[q] = 0; });
      if (solve(p, 2) !== 1 || (L.singles && !singlesSolvable(p))) pair.forEach(function (q, i) { p[q] = keep[i]; });
      else clues -= pair.length;
    });
    return { puzzle: p, sol: sol };
  }
  function parseGrid(s) {
    s = String(s).replace(/[\s|+\-]/g, "").replace(/[.]/g, "0");
    return /^[0-9]{81}$/.test(s) ? s.split("").map(Number) : null;
  }

  // ---------- game state ----------
  var game, sel = 40, pencilMode = false, undoStack = [], redoStack = [], timerId = null, paused = false;
  function fresh(puzzle, sol, level) {
    return { level: level, givens: puzzle.slice(), sol: sol ? sol.slice() : null, vals: puzzle.slice(), notes: new Array(81).fill(0), time: 0, hints: 0, mode: "play", done: false };
  }
  function cleanGame(o) {
    if (!o || typeof o !== "object") return null;
    var arr = function (a, max) { return Array.isArray(a) && a.length === 81 && a.every(function (v) { return Number.isInteger(v) && v >= 0 && v <= max; }) ? a.slice() : null; };
    var g = arr(o.givens, 9), v = arr(o.vals, 9), n = arr(o.notes, ALL), s = o.sol == null ? null : arr(o.sol, 9);
    if (!g || !v || !n) return null;
    if (o.mode !== "enter") {
      for (var k = 0; k < 81; k++) if (g[k] && v[k] !== g[k]) return null;
      if (s && (s.some(function (x) { return !x; }) || g.some(function (x, k2) { return x && x !== s[k2]; }))) return null;
    }
    return { level: LEVELS[o.level] ? o.level : "custom", givens: g, sol: s, vals: v, notes: n, time: Number.isFinite(o.time) && o.time >= 0 ? Math.floor(o.time) : 0,
      hints: Number.isInteger(o.hints) && o.hints >= 0 ? o.hints : 0, mode: o.mode === "enter" ? "enter" : "play", done: o.done === true };
  }
  function save() { S3.store(KEY, game); }

  // ---------- board ----------
  var board = $("#board"), cells = [];
  for (i = 0; i < 81; i++) {
    var cell = h("div", { "class": "su-cell", role: "gridcell", "data-k": i, "aria-label": "Row " + (ROW[i] + 1) + " column " + (COL[i] + 1) });
    if (COL[i] % 3 === 2 && COL[i] < 8) cell.classList.add("br");
    if (ROW[i] % 3 === 2 && ROW[i] < 8) cell.classList.add("bb");
    board.appendChild(cell); cells.push(cell);
  }
  function conflicts(k) { var v = game.vals[k]; return v && PEERS[k].some(function (p) { return game.vals[p] === v; }); }
  function render() {
    var v = game.vals, sv = v[sel], show = $("#checkErr").checked;
    cells.forEach(function (el, k) {
      var given = game.mode === "play" && game.givens[k] > 0, val = v[k];
      var wrong = show && val && !given && ((game.sol && game.mode === "play" && val !== game.sol[k]) || conflicts(k));
      el.className = "su-cell" + (COL[k] % 3 === 2 && COL[k] < 8 ? " br" : "") + (ROW[k] % 3 === 2 && ROW[k] < 8 ? " bb" : "") +
        (given ? " given" : "") + (k === sel ? " sel" : "") +
        (k !== sel && (ROW[k] === ROW[sel] || COL[k] === COL[sel] || BOX[k] === BOX[sel]) ? " peer" : "") +
        (sv && val === sv && k !== sel ? " same" : "") + (wrong ? " wrong" : "");
      el.textContent = "";
      if (val) el.textContent = String(val);
      else if (game.notes[k]) {
        var g = h("div", { "class": "su-notes" });
        for (var d = 1; d <= 9; d++) g.appendChild(h("span", { "class": sv === d ? "hl" : "", text: game.notes[k] & (1 << d) ? String(d) : "" }));
        el.appendChild(g);
      }
      el.setAttribute("aria-label", "Row " + (ROW[k] + 1) + " column " + (COL[k] + 1) + ": " + (val || "empty"));
    });
    board.setAttribute("aria-activedescendant", "");
    // number pad: how many of each digit are left to place
    $$(".su-key", $("#pad")).forEach(function (b) {
      var d = +b.dataset.d, n = v.filter(function (x) { return x === d; }).length;
      b.querySelector("small").textContent = game.mode === "play" ? String(Math.max(0, 9 - n)) : "";
      b.classList.toggle("done", game.mode === "play" && n >= 9);
    });
    $("#undo").disabled = !undoStack.length; $("#redo").disabled = !redoStack.length;
    $("#pencil").setAttribute("aria-pressed", String(pencilMode));
    $("#level").textContent = game.mode === "enter" ? "Entering a puzzle" : { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" }[game.level] || "Your puzzle";
    $("#hintsUsed").hidden = !game.hints; $("#hintsUsed").textContent = game.hints + " hint" + (game.hints === 1 ? "" : "s");
    ["solve", "playThis"].forEach(function (id) { $("#" + id).hidden = game.mode !== "enter"; });
    $("#enter").textContent = game.mode === "enter" ? "Clear grid" : "Enter a puzzle";
    $("#hint").disabled = $("#autoNotes").disabled = game.mode !== "play";
    tick(true);
  }
  function snapshot() { undoStack.push({ vals: game.vals.slice(), notes: game.notes.slice() }); if (undoStack.length > 500) undoStack.shift(); redoStack = []; }
  function restore(from, to) {
    if (!from.length) return;
    to.push({ vals: game.vals.slice(), notes: game.notes.slice() });
    var s = from.pop(); game.vals = s.vals; game.notes = s.notes; game.done = false; $("#win").hidden = true;
    save(); render();
  }
  function editable(k) { return !(game.mode === "play" && game.givens[k]) && !game.done && !paused; }
  function setDigit(d, asNote) {
    var k = sel; if (!editable(k)) return;
    if (asNote) {
      if (game.vals[k]) return;
      snapshot(); game.notes[k] ^= 1 << d;
    } else {
      snapshot();
      game.vals[k] = game.vals[k] === d ? 0 : d;
      if (game.vals[k]) PEERS[k].forEach(function (p) { game.notes[p] &= ~(1 << d); });
    }
    save(); render(); checkWin();
  }
  function erase() { var k = sel; if (!editable(k) || (!game.vals[k] && !game.notes[k])) return; snapshot(); game.vals[k] = 0; game.notes[k] = 0; save(); render(); }
  function checkWin() {
    if (game.mode !== "play" || !game.sol || game.done) return;
    if (game.vals.every(function (v, k) { return v === game.sol[k]; })) {
      game.done = true; save(); tick(true);
      var w = $("#win"); w.textContent = "";
      w.appendChild(h("b", { text: "Solved!" }));
      w.appendChild(h("span", { text: fmt(game.time) + (game.hints ? " · " + game.hints + " hint" + (game.hints === 1 ? "" : "s") : " · no hints") }));
      w.appendChild(h("button", { "class": "btn primary", text: "New game", onclick: function () { newGame(); } }));
      w.hidden = false; S3.done();
    }
  }

  // ---------- timer ----------
  function fmt(s) { var m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); }
  function tick(redrawOnly) {
    $("#timer").textContent = fmt(game.time);
    if (redrawOnly) return;
  }
  function running() { return game.mode === "play" && !game.done && !paused && document.visibilityState === "visible"; }
  timerId = setInterval(function () { if (running()) { game.time++; tick(true); if (game.time % 5 === 0) save(); } }, 1000);
  function setPaused(p) {
    paused = p && game.mode === "play" && !game.done;
    board.classList.toggle("blur", paused); $("#paused").hidden = !paused;
  }
  $("#pause").addEventListener("click", function () { setPaused(!paused); });
  $("#resume").addEventListener("click", function () { setPaused(false); board.focus(); });

  // ---------- input ----------
  board.addEventListener("pointerdown", function (e) { var c = e.target.closest(".su-cell"); if (c) { sel = +c.dataset.k; render(); } });
  board.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === "z") { e.preventDefault(); restore(e.shiftKey ? redoStack : undoStack, e.shiftKey ? undoStack : redoStack); }
      if (e.key.toLowerCase() === "y") { e.preventDefault(); restore(redoStack, undoStack); }
      return;
    }
    var mv = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (mv) {
      e.preventDefault();
      var r = ROW[sel], c = COL[sel];
      if (mv === -9) r = (r + 8) % 9; else if (mv === 9) r = (r + 1) % 9; else if (mv === -1) c = (c + 8) % 9; else c = (c + 1) % 9;
      sel = r * 9 + c; render(); return;
    }
    var m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) { e.preventDefault(); setDigit(+m[2], e.shiftKey || pencilMode); return; }
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { e.preventDefault(); erase(); return; }
    if (e.key.toLowerCase() === "n") { pencilMode = !pencilMode; render(); }
  });
  var pad = $("#pad");
  for (var d = 1; d <= 9; d++) pad.appendChild(h("button", { type: "button", "class": "su-key", "data-d": d, "aria-label": "Digit " + d }, [h("b", { text: String(d) }), h("small")]));
  pad.addEventListener("click", function (e) { var b = e.target.closest("[data-d]"); if (b) { setDigit(+b.dataset.d, pencilMode); board.focus({ preventScroll: true }); } });
  $("#erase").addEventListener("click", erase);
  $("#undo").addEventListener("click", function () { restore(undoStack, redoStack); });
  $("#redo").addEventListener("click", function () { restore(redoStack, undoStack); });
  $("#pencil").addEventListener("click", function () { pencilMode = !pencilMode; render(); });
  $("#checkErr").addEventListener("change", function (e) { S3.store("sudoku.check", e.target.checked); render(); });
  $("#hint").addEventListener("click", function () {
    if (game.mode !== "play" || !game.sol || game.done) return;
    var k = sel;
    if (game.givens[k] || game.vals[k] === game.sol[k]) {
      var empty = []; for (var q = 0; q < 81; q++) if (game.vals[q] !== game.sol[q]) empty.push(q);
      if (!empty.length) return;
      // Prefer the cell with the fewest candidates: the most useful next step.
      empty.sort(function (a, b) { return bits(candidates(game.vals, a)) - bits(candidates(game.vals, b)); });
      k = empty[0]; sel = k;
    }
    snapshot(); game.vals[k] = game.sol[k]; game.notes[k] = 0; game.hints++;
    PEERS[k].forEach(function (p) { game.notes[p] &= ~(1 << game.sol[k]); });
    save(); render(); checkWin();
  });
  $("#autoNotes").addEventListener("click", function () {
    if (game.mode !== "play") return;
    snapshot();
    for (var q = 0; q < 81; q++) game.notes[q] = game.vals[q] ? 0 : candidates(game.vals, q);
    save(); render();
  });

  // ---------- new game / solver ----------
  var diff = S3.store("sudoku.diff"); diff = LEVELS[diff] ? diff : "medium";
  function newGame() {
    var g = generate(diff);
    game = fresh(g.puzzle, g.sol, diff); undoStack = []; redoStack = []; sel = 40; setPaused(false);
    $("#win").hidden = true; $("#solverMsg").textContent = ""; save(); render(); board.focus({ preventScroll: true });
  }
  function seg(el, value, onPick) {
    $$("button", el).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === value));
      b.addEventListener("click", function () { $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); onPick(b.dataset.v); });
    });
  }
  seg($("#diff"), diff, function (v) { diff = v; S3.store("sudoku.diff", v); });
  $("#new").addEventListener("click", function () {
    var b = $("#new"); b.disabled = true; b.lastChild.textContent = "Making…";
    setTimeout(function () { newGame(); b.disabled = false; b.lastChild.textContent = "New game"; }, 20);
  });
  function msg(text, kind) { var m = $("#solverMsg"); m.className = "su-msg " + (kind || ""); m.textContent = text; }
  function startEntering(vals) {
    game = { level: "custom", givens: new Array(81).fill(0), sol: null, vals: vals || new Array(81).fill(0), notes: new Array(81).fill(0), time: 0, hints: 0, mode: "enter", done: false };
    undoStack = []; redoStack = []; setPaused(false); $("#win").hidden = true; save(); render(); board.focus({ preventScroll: true });
  }
  $("#enter").addEventListener("click", function () { startEntering(); msg("Type the givens into the grid, then press Solve or Play this."); });
  function analyse() {
    var out = new Array(81).fill(0), clues = game.vals.filter(Boolean).length;
    var dupe = game.vals.some(function (v, k) { return conflicts(k); });
    var n = dupe ? 0 : solve(game.vals, 2, out);
    return { n: n, out: out, clues: clues, dupe: dupe };
  }
  $("#solve").addEventListener("click", function () {
    var a = analyse();
    if (a.dupe) return msg("No solution: the same digit appears twice in a row, column or box (shown in red).", "bad");
    if (!a.n) return msg("No solution: these clues contradict each other.", "bad");
    snapshot(); game.vals = a.out; save(); render();
    msg(a.n === 1 ? "Solved. This puzzle has exactly one solution (" + a.clues + " clues)." : "This puzzle has more than one solution; here is one of them. A proper Sudoku needs more clues.", a.n === 1 ? "ok" : "warn");
    S3.done();
  });
  $("#playThis").addEventListener("click", function () {
    var a = analyse();
    if (a.dupe || !a.n) return msg("Can't play this: it has no solution.", "bad");
    if (a.n > 1) return msg("Can't play this yet: it has more than one solution. Add more clues.", "warn");
    game = fresh(game.vals, a.out, "custom"); undoStack = []; redoStack = []; save(); render();
    msg("Your puzzle has exactly one solution. Good luck!", "ok");
  });
  $("#load").addEventListener("click", function () {
    var g = parseGrid($("#paste").value);
    if (!g) return msg("That isn't 81 digits (use 0 or . for blanks).", "bad");
    startEntering(g); msg("Loaded. Press Solve, or Play this to play it.");
  });
  $("#paste").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#load").click(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && game) save(); });

  // ---------- boot ----------
  $("#checkErr").checked = S3.store("sudoku.check") !== false;
  game = cleanGame(S3.store(KEY));
  if (game) render(); else newGame();

  window.S3_DEMO = function () {
    var p = parseGrid("530070000600195000098000060800060003400803001700020006060000280000419005000080079");
    var s = new Array(81).fill(0); solve(p, 1, s);
    game = fresh(p, s, "medium"); game.time = 254;
    var moves = { 2: 4, 3: 6, 5: 8, 10: 7, 18: 1 }; Object.keys(moves).forEach(function (k) { game.vals[k] = moves[k]; });
    game.vals[11] = 3; // a mistake, to show error checking
    game.notes[6] = (1 << 1) | (1 << 9); game.notes[7] = (1 << 1) | (1 << 2); game.notes[8] = (1 << 2) | (1 << 8);
    sel = 22; undoStack = [{ vals: p.slice(), notes: new Array(81).fill(0) }]; redoStack = []; render();
  };

  window.S3_SELFTEST = function () {
    // Arto Inkala's "world's hardest Sudoku"
    var hard = parseGrid("800000000003600000070090200050007000000045700000100030001000068008500010090000400"), out = new Array(81).fill(0);
    var n = solve(hard, 2, out), okHard = n === 1 && out.join("") === "812753649943682175675491283154237896369845721287169534521974368438526917796318452";
    var dup = parseGrid("550000000000000000000000000000000000000000000000000000000000000000000000000000000");
    var contra = parseGrid("123456780000000009000000000000000000000000000000000000000000000000000000000000000"); // cell 8 can't be anything
    var many = solve(new Array(81).fill(0), 2) === 2;
    var g = generate("medium"), clues = g.puzzle.filter(Boolean).length, check = new Array(81).fill(0);
    var okGen = solve(g.puzzle, 2, check) === 1 && check.join("") === g.sol.join("") && clues <= 40 && singlesSolvable(g.puzzle) &&
      g.puzzle.every(function (v, k) { return !v || v === g.sol[k]; }) && g.puzzle.every(function (v, k) { return !!v === !!g.puzzle[80 - k]; });
    var e = generate("expert"), okExp = solve(e.puzzle, 2) === 1;
    var easySingles = singlesSolvable(parseGrid("530070000600195000098000060800060003400803001700020006060000280000419005000080079"));
    var bad = cleanGame({ givens: [1], vals: [], notes: [] }) === null && cleanGame({ givens: new Array(81).fill(0), vals: new Array(81).fill(10), notes: new Array(81).fill(0) }) === null;
    return okHard && solve(dup, 2) === 0 && solve(contra, 2) === 0 && many && okGen && okExp && easySingles && !singlesSolvable(hard) && bad &&
      parseGrid("..3.2.6..9..3.5..1..18.64....81.29..7.......8..67.82....26.95..8..2.3..9..5.1.3..").length === 81 && parseGrid("123") === null;
  };
})();
