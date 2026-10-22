// Runs the Block Drop and Snake Arena TV parts in Node with a tiny fake DOM, with a test
// hook added to reach their state, and checks line clears, junk rows and collisions.
var path = require("path"), fs = require("fs"), vm = require("vm"), assert = require("assert");
var h = require("./harness.js");
function Node(tag) { this.tagName = tag; this.style = {}; this.className = ""; this.childNodes = []; this.parentNode = null; this.text = ""; }
Node.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; };
Node.prototype.removeChild = function (c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; return c; };
Node.prototype.contains = function (c) { for (var n = c; n; n = n.parentNode) if (n === this) return true; return false; };
Object.defineProperty(Node.prototype, "firstChild", { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(Node.prototype, "textContent", { get: function () { return this.text + this.childNodes.map(function (c) { return c.textContent; }).join(""); }, set: function (v) { this.childNodes = []; this.text = String(v); } });
var body = new Node("body");
var reports = [];
var sandbox = { setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval, Date: Date, Math: Math, String: String, console: console,
  document: { body: body, createElement: function (t) { return new Node(t); }, createTextNode: function (t) { var n = new Node("#text"); n.text = String(t); return n; } },
  TVHub: { report: function (d) { reports.push(JSON.parse(JSON.stringify(d))); } } };
sandbox.window = sandbox;
sandbox.TVGAMES = {};
vm.createContext(sandbox);
function load(file, hook) {
  var src = fs.readFileSync(path.join(__dirname, "..", "apps", "home", "games", file), "utf8");
  if (hook) src = src.replace(/\}\)\(\);\s*$/, hook + "\n})();");
  vm.runInContext(src, sandbox, { filename: file });
}
load("kit.js");
load("blocks.js", "window.__bd = { game: function () { return game; }, lock: lock, emptyRow: emptyRow };");
load("snake.js", "window.__sn = { game: function () { return game; } };");
var wait = h.wait;
function racer(id, name) { return { id: id, name: name, color: "#4f8cff", alive: true, score: 0 }; }
function view(phase, mode, run, racers) { return { phase: phase, mode: mode, run: run, seed: 12345 + run, racers: racers, standings: racers, newRecord: 0, records: [] }; }
h.run(async function () {
  // Block Drop: one line clear in solo.
  var box = body.appendChild(new Node("div"));
  var BD = sandbox.TVGAMES.blocks, bd = sandbox.__bd;
  BD.render(box, view("countdown", "solo", 1, [racer(1, "Ana")]));
  BD.render(box, view("playing", "solo", 1, [racer(1, "Ana")]));
  var w = bd.game().wells[0];
  assert.ok(w.piece, "a piece falls");
  for (var x = 4; x < 10; x++) w.grid[19][x] = "#fff";
  w.piece = { type: "I", cells: [[0, 1], [1, 1], [2, 1], [3, 1]], size: 4, color: "#2fc4c4", x: 0, y: 10 };
  BD.onEvent({ t: "input", id: 1, run: 1, move: "drop" });
  assert.strictEqual(w.lines, 1);
  assert.strictEqual(w.score, 100 + 8 * 2);
  assert.ok(w.grid[19].every(function (c) { return !c; }), "bottom row is empty after the clear");
  // Moves: left against the wall does nothing, rotate turns, O does not turn.
  w.piece = { type: "T", cells: [[1, 0], [0, 1], [1, 1], [2, 1]], size: 3, color: "#b07cf2", x: 0, y: 5 };
  BD.onEvent({ t: "input", id: 1, run: 1, move: "left" });
  assert.strictEqual(w.piece.x, 0);
  BD.onEvent({ t: "input", id: 1, run: 1, move: "rotate" });
  assert.notDeepStrictEqual(w.piece.cells, [[1, 0], [0, 1], [1, 1], [2, 1]]);
  BD.onEvent({ t: "input", id: 1, run: 2, move: "right" }); // old run: ignored
  BD.onEvent({ t: "input", id: 9, run: 1, move: "right" }); // not a player: ignored
  // Top out: keep dropping until the well is full.
  for (var i = 0; i < 200 && w.alive; i++) BD.onEvent({ t: "input", id: 1, run: 1, move: "drop" });
  assert.strictEqual(w.alive, false);
  var rep = reports[reports.length - 1];
  assert.deepStrictEqual([rep.run, rep.over, rep.crashes[0].id], [1, true, 1]);
  BD.render(box, view("final", "solo", 1, [racer(1, "Ana")]));

  // Together: a double clears sends one junk row; the last well left wins.
  reports = [];
  var two = [racer(1, "Ana"), racer(2, "Bob")];
  BD.render(box, view("countdown", "multi", 2, two));
  BD.render(box, view("playing", "multi", 2, two));
  var a = bd.game().wells[0], b = bd.game().wells[1];
  assert.strictEqual(a.next, b.next, "same pieces in every well");
  for (x = 1; x < 10; x++) { a.grid[19][x] = "#fff"; a.grid[18][x] = "#fff"; }
  a.piece = { type: "I", cells: [[1, 0], [1, 1], [1, 2], [1, 3]], size: 4, color: "#2fc4c4", x: -1, y: 5 };
  BD.onEvent({ t: "input", id: 1, run: 2, move: "drop" });
  assert.strictEqual(a.lines, 2);
  var junk = b.grid[19].filter(function (c) { return c === "#4a4d53"; }).length;
  assert.strictEqual(junk, 9, "one junk row with one gap");
  assert.ok(b.grid[18].every(function (c) { return !c; }));
  for (i = 0; i < 200 && b.alive; i++) BD.onEvent({ t: "input", id: 2, run: 2, move: "drop" });
  rep = reports[reports.length - 1];
  assert.strictEqual(rep.over, true);
  assert.deepStrictEqual(rep.crashes.map(function (c) { return c.id; }), [2]);
  assert.deepStrictEqual(rep.final, [{ id: 1, score: a.score }]);
  BD.render(box, view("final", "multi", 2, two));
  assert.strictEqual(bd.game().timer, null, "timer stopped");

  // Junk that would push blocks out of the top ends that well, and does not break the others.
  reports = [];
  var three = [racer(1, "Ana"), racer(2, "Bob"), racer(3, "Cem")];
  BD.render(box, view("countdown", "multi", 5, three));
  BD.render(box, view("playing", "multi", 5, three));
  a = bd.game().wells[0]; b = bd.game().wells[1]; var c = bd.game().wells[2];
  b.grid[0][3] = "#fff";
  for (var yy = 16; yy < 20; yy++) for (x = 1; x < 10; x++) a.grid[yy][x] = "#fff";
  a.piece = { type: "I", cells: [[1, 0], [1, 1], [1, 2], [1, 3]], size: 4, color: "#2fc4c4", x: -1, y: 0 };
  BD.onEvent({ t: "input", id: 1, run: 5, move: "drop" });
  assert.strictEqual(a.lines, 4);
  assert.strictEqual(b.alive, false, "Bob pushed out");
  assert.strictEqual(b.grid.length, 20, "Bob keeps 20 rows");
  assert.strictEqual(c.grid.length, 20);
  assert.strictEqual(c.grid[19].filter(function (q) { return q; }).length, 9, "Cem still gets junk");
  assert.ok(a.piece && a.piece.y < 3, "Ana gets a new piece");
  assert.deepStrictEqual(reports[0].crashes, [{ id: 2, score: 0 }]);
  assert.strictEqual(reports[0].over, false);
  // Cem out next: the end report lists every player who is out (Bob again too).
  for (i = 0; i < 200 && c.alive; i++) BD.onEvent({ t: "input", id: 3, run: 5, move: "drop" });
  rep = reports[reports.length - 1];
  assert.strictEqual(rep.over, true);
  assert.deepStrictEqual(rep.crashes.map(function (q) { return q.id; }), [2, 3]);

  // Solo with nobody to play (phone locked): only the final screen, no error.
  BD.render(box, { phase: "final", mode: "solo", run: 6, seed: 99, racers: [], standings: [], newRecord: 0, records: [] });

  // Leaving the game removes the scene; the timer stops on its next tick.
  BD.render(box, view("countdown", "solo", 7, [racer(1, "Ana")]));
  BD.render(box, view("playing", "solo", 7, [racer(1, "Ana")]));
  while (box.firstChild) box.removeChild(box.firstChild);
  await wait(90);
  assert.strictEqual(bd.game().timer, null, "timer stopped after the scene left");

  // Snake Arena: head-on hit ends both; wall ends a snake; eating grows.
  reports = [];
  var SN = sandbox.TVGAMES.snake, sn = sandbox.__sn;
  three = [racer(1, "Ana"), racer(2, "Bob"), racer(3, "Cem")];
  SN.render(box, view("countdown", "multi", 3, three));
  var g = sn.game();
  assert.strictEqual(g.snakes.length, 3);
  assert.strictEqual(g.food.length, 4, "one apple more than snakes");
  // Put Ana and Bob face to face on row 2, two cells apart.
  function lay(s, cells, dir) {
    for (var k = 0; k < s.body.length; k++) { s.body[k].x = cells[k][0]; s.body[k].y = cells[k][1]; }
    s.dir = dir;
  }
  g.food = g.food.filter(function (f) { f.node.style.display = "none"; return false; });
  lay(g.snakes[0], [[10, 2], [9, 2], [8, 2], [7, 2]], "right");
  lay(g.snakes[1], [[12, 2], [13, 2], [14, 2], [15, 2]], "left");
  lay(g.snakes[2], [[20, 10], [19, 10], [18, 10], [17, 10]], "right");
  g.food.push({ x: 21, y: 10, node: new Node("div") });
  SN.render(box, view("playing", "multi", 3, three));
  SN.onEvent({ t: "input", id: 3, run: 3, dir: "left" }); // reverse: ignored
  await wait(170);
  rep = reports[0];
  assert.ok(rep, "a report after the first step");
  assert.deepStrictEqual(rep.crashes.map(function (c) { return c.id; }).sort(), [1, 2]);
  assert.strictEqual(rep.over, true, "one snake left -> over");
  assert.strictEqual(g.snakes[2].body.length, 5, "Cem ate and grew");
  assert.deepStrictEqual(rep.final, [{ id: 3, score: 1 }]);
  // Score updates every 10 s while nobody goes out.
  reports = [];
  SN.render(box, view("countdown", "multi", 8, [racer(1, "Ana"), racer(2, "Bob")]));
  g = sn.game();
  g.scoresAt = Date.now() - 10001;
  g.snakes[0].score = 3;
  SN.render(box, view("playing", "multi", 8, [racer(1, "Ana"), racer(2, "Bob")]));
  await wait(150);
  assert.deepStrictEqual(reports[0], { run: 8, crashes: [], scores: [{ id: 1, score: 3 }, { id: 2, score: 0 }] });
  while (box.firstChild) box.removeChild(box.firstChild);
  await wait(150);

  // Solo: the wall ends the run; turns are queued and a reverse is ignored.
  reports = [];
  SN.render(box, view("countdown", "solo", 4, [racer(1, "Ana")]));
  g = sn.game();
  lay(g.snakes[0], [[40, 5], [39, 5], [38, 5], [37, 5]], "right");
  SN.render(box, view("playing", "solo", 4, [racer(1, "Ana")]));
  SN.onEvent({ t: "input", id: 1, run: 4, dir: "down" });
  SN.onEvent({ t: "input", id: 1, run: 4, dir: "up" }); // reverse of the queued turn: ignored
  SN.onEvent({ t: "input", id: 1, run: 4, dir: "right" });
  await wait(200);
  assert.strictEqual(g.snakes[0].body[0].y, 6, "turned down");
  await wait(800);
  rep = reports[0];
  assert.ok(rep && rep.over && rep.crashes[0].id === 1, "hit the right wall");
});
