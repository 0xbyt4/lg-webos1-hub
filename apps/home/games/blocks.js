// Block Drop, TV part (ES5, WebKit 537): falling blocks, cleared lines, levels.
// Solo: one well with the next piece and the best scores. Together: up to 4 wells side
// by side, all with the same piece order (one seed from the hub); clearing 2 or more
// lines at once sends rows of junk to the others; the last one standing wins.
// Its own look and rules: a 12-wide well, this project's colors, no landing preview, and
// points that grow with the square of the lines cleared at once.
// Light on the TV: no animation loop that draws every frame. A 40 ms timer checks when a
// piece must fall, and only cells that changed get a new color.
(function () {
  var K = window.TVKit;
  var COLS = 12, ROWS = 20;
  var EMPTY = "#1c1f24", JUNK = "#4a4d53";
  var LINE_POINTS = [0, 60, 240, 540, 960]; // 60 x lines x lines, times the level
  var PIECES = {
    I: { color: "#ff7a59", size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { color: "#2ec4b6", size: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
    T: { color: "#a3d65c", size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { color: "#ff6fae", size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { color: "#4cc9f0", size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { color: "#f9c74f", size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { color: "#b388ff", size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
  };
  var ORDER = ["I", "O", "T", "S", "Z", "J", "L"];
  var CSS = [
    ".bd-scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background: #101113; }",
    ".bd-well { position: absolute; background: #15171a; border-radius: 12px; }",
    ".bd-well.out { opacity: .35; }",
    ".bd-cell { position: absolute; border-radius: 5px; }",
    ".bd-name { position: absolute; font-size: 32px; font-weight: 600; color: #f3f3f1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".bd-stat { position: absolute; font-size: 28px; color: #8d929a; white-space: nowrap; }",
    ".bd-stat b { color: #f3f3f1; font-weight: 600; }",
    ".bd-panel { position: absolute; left: 330px; top: 230px; width: 340px; }",
    ".bd-panel .num { font-size: 72px; font-weight: 300; color: #f3f3f1; margin: 4px 0 26px; }",
    ".bd-next { position: relative; width: 136px; height: 136px; margin: 12px 0 30px; }"
  ].join("\n");

  var game = null; // the run on screen
  var shown = { run: 0, seed: 0, phase: "" };

  function interval(w) {
    return Math.max(90, 800 - (w.level - 1) * 75);
  }

  function rotated(cells, size) {
    return cells.map(function (c) { return [size - 1 - c[1], c[0]]; });
  }

  function fits(w, cells, x, y) {
    for (var i = 0; i < cells.length; i++) {
      var cx = x + cells[i][0], cy = y + cells[i][1];
      if (cx < 0 || cx >= COLS || cy >= ROWS) return false;
      if (cy >= 0 && w.grid[cy][cx]) return false;
    }
    return true;
  }

  // A bag of the seven pieces in a random order, then the next bag.
  function nextType(w) {
    if (!w.bag.length) {
      w.bag = ORDER.slice();
      for (var i = w.bag.length - 1; i > 0; i--) {
        var j = Math.floor(w.rand() * (i + 1));
        var t = w.bag[i]; w.bag[i] = w.bag[j]; w.bag[j] = t;
      }
    }
    return w.bag.pop();
  }

  function spawn(w) {
    var type = w.next || nextType(w);
    w.next = nextType(w);
    var p = PIECES[type];
    w.piece = { type: type, cells: p.cells.map(function (c) { return [c[0], c[1]]; }), size: p.size, color: p.color,
      x: Math.floor((COLS - p.size) / 2), y: 0 };
    if (!fits(w, w.piece.cells, w.piece.x, w.piece.y)) out(w);
    w.dropAt = Date.now() + interval(w);
  }

  function out(w) {
    if (!w.alive) return;
    w.alive = false;
    w.piece = null;
    w.node.className = "bd-well out";
    K.sound("wrong");
    game.crashes.push({ id: w.id, score: w.score });
  }

  function lock(w) {
    var p = w.piece;
    for (var i = 0; i < p.cells.length; i++) {
      var cy = p.y + p.cells[i][1];
      if (cy < 0) return out(w); // locked above the top
      w.grid[cy][p.x + p.cells[i][0]] = p.color;
    }
    var cleared = 0;
    for (var y = ROWS - 1; y >= 0; y--) {
      if (w.grid[y].every(function (c) { return !!c; })) {
        w.grid.splice(y, 1);
        w.grid.unshift(emptyRow());
        cleared++;
        y++;
      }
    }
    if (cleared) {
      w.lines += cleared;
      w.score += LINE_POINTS[cleared] * w.level;
      w.level = 1 + Math.floor(w.lines / 10);
      K.sound(cleared === 4 ? "win" : "correct");
      if (!game.solo && cleared >= 2) attack(w, cleared === 4 ? 4 : cleared - 1);
    }
    spawn(w);
  }

  // Rows of junk, with one gap, pushed up from the bottom of every other well.
  function attack(from, rows) {
    var gap = Math.floor(game.gapRand() * COLS); // own generator: the piece order stays the same in every well
    for (var i = 0; i < game.wells.length; i++) {
      var w = game.wells[i];
      if (w === from || !w.alive) continue;
      for (var r = 0; r < rows; r++) {
        if (w.grid[0].some(function (c) { return !!c; })) {
          out(w); // the junk would push blocks out of the top
          break;
        }
        w.grid.shift();
        var junk = [];
        for (var x = 0; x < COLS; x++) junk.push(x === gap ? null : JUNK);
        w.grid.push(junk);
      }
      if (w.alive && w.piece && !fits(w, w.piece.cells, w.piece.x, w.piece.y)) {
        if (fits(w, w.piece.cells, w.piece.x, w.piece.y - rows)) w.piece.y -= rows;
        else out(w);
      }
      draw(w);
    }
  }

  function emptyRow() {
    var row = [];
    for (var x = 0; x < COLS; x++) row.push(null);
    return row;
  }

  // Paint only the cells whose color changed since the last draw.
  function draw(w) {
    var want = [];
    var y, x;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) want.push(w.grid[y][x] || EMPTY);
    var p = w.piece;
    if (p && w.alive) {
      for (var j = 0; j < p.cells.length; j++) {
        var cx = p.x + p.cells[j][0], cy = p.y + p.cells[j][1];
        if (cy >= 0) want[cy * COLS + cx] = p.color;
      }
    }
    for (var k = 0; k < want.length; k++) {
      if (want[k] === w.drawn[k]) continue;
      w.drawn[k] = want[k];
      w.cells[k].style.background = want[k];
    }
    if (w.scoreNode) w.scoreNode.textContent = String(w.score);
    if (w.linesNode) w.linesNode.textContent = String(w.lines);
    if (w.levelNode) w.levelNode.textContent = String(w.level);
    if (w.nextCells) drawNext(w);
  }

  function drawNext(w) {
    if (w.drawnNext === w.next) return;
    w.drawnNext = w.next;
    var p = PIECES[w.next];
    for (var i = 0; i < 16; i++) w.nextCells[i].style.background = "transparent";
    if (!p) return;
    for (var j = 0; j < p.cells.length; j++) w.nextCells[p.cells[j][1] * 4 + p.cells[j][0]].style.background = p.color;
  }

  function makeWell(scene, racer, x0, y0, cs) {
    var node = K.el("div", "bd-well");
    node.style.left = (x0 - 8) + "px";
    node.style.top = (y0 - 8) + "px";
    node.style.width = (COLS * cs + 14) + "px";
    node.style.height = (ROWS * cs + 14) + "px";
    var cells = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var c = K.el("div", "bd-cell");
        c.style.left = (8 + x * cs) + "px";
        c.style.top = (8 + y * cs) + "px";
        c.style.width = (cs - 3) + "px";
        c.style.height = (cs - 3) + "px";
        c.style.background = EMPTY;
        node.appendChild(c);
        cells.push(c);
      }
    }
    scene.appendChild(node);
    var grid = [];
    for (var r = 0; r < ROWS; r++) grid.push(emptyRow());
    var drawn = [];
    for (var d = 0; d < COLS * ROWS; d++) drawn.push(EMPTY);
    var w = { id: racer.id, name: racer.name, color: racer.color, alive: racer.alive, score: racer.score, lines: 0, level: 1,
      grid: grid, bag: [], next: null, piece: null, rand: K.random(game.seed), node: node, cells: cells, drawn: drawn, dropAt: 0 };
    if (!w.alive) node.className = "bd-well out"; // crashed before a page reload
    return w;
  }

  function build(box, view) {
    K.clear(box);
    box.appendChild(K.style(CSS));
    var scene = K.el("div", "bd-scene");
    box.appendChild(scene);
    var solo = view.mode === "solo";
    game = { run: view.run, seed: view.seed, solo: solo, scene: scene, wells: [], crashes: [], timer: null,
      gapRand: K.random(view.seed + 7919) };
    scene.appendChild(K.el("div", "label kt-label", "BLOCK DROP · " + (solo ? "SOLO" : "TOGETHER") + " · GAME " + view.run));
    if (solo && view.racers.length) {
      var w = makeWell(scene, view.racers[0], 720, 180, 40);
      var panel = K.el("div", "bd-panel");
      panel.appendChild(K.el("div", "label", "SCORE"));
      w.scoreNode = K.el("div", "num", "0");
      panel.appendChild(w.scoreNode);
      panel.appendChild(K.el("div", "label", "NEXT"));
      var next = K.el("div", "bd-next");
      w.nextCells = [];
      for (var i = 0; i < 16; i++) {
        var c = K.el("div", "bd-cell");
        c.style.left = (i % 4) * 34 + "px";
        c.style.top = Math.floor(i / 4) * 34 + "px";
        c.style.width = "31px";
        c.style.height = "31px";
        next.appendChild(c);
        w.nextCells.push(c);
      }
      panel.appendChild(next);
      var stats = K.el("div", "bd-stat");
      stats.style.position = "relative";
      stats.appendChild(document.createTextNode("Lines "));
      w.linesNode = K.el("b", null, "0");
      stats.appendChild(w.linesNode);
      stats.appendChild(document.createTextNode("\u2003 Level "));
      w.levelNode = K.el("b", null, "1");
      stats.appendChild(w.levelNode);
      panel.appendChild(stats);
      scene.appendChild(panel);
      game.wells.push(w);
    }
    if (solo) {
      game.side = K.el("div", "kt-side");
      scene.appendChild(game.side);
    } else if (!solo) {
      var n = view.racers.length, cs = 30, wellW = COLS * cs, gapW = 70;
      var x0 = Math.round((1920 - (n * wellW + (n - 1) * gapW)) / 2);
      for (var k = 0; k < n; k++) {
        var x = x0 + k * (wellW + gapW), well = makeWell(scene, view.racers[k], x, 230, cs);
        var name = K.el("div", "bd-name");
        name.style.left = x + "px";
        name.style.top = "170px";
        name.style.width = wellW + "px";
        name.appendChild(K.dot(view.racers[k].color));
        name.appendChild(document.createTextNode(view.racers[k].name));
        scene.appendChild(name);
        var stat = K.el("div", "bd-stat");
        stat.style.left = x + "px";
        stat.style.top = (230 + ROWS * cs + 20) + "px";
        well.scoreNode = K.el("b", null, String(well.score));
        stat.appendChild(well.scoreNode);
        stat.appendChild(document.createTextNode(" points · "));
        well.linesNode = K.el("b", null, "0");
        stat.appendChild(well.linesNode);
        stat.appendChild(document.createTextNode(" lines"));
        scene.appendChild(stat);
        game.wells.push(well);
      }
    }
    game.over = K.el("div", "kt-over");
    scene.appendChild(game.over);
    for (var m = 0; m < game.wells.length; m++) {
      game.wells[m].next = nextType(game.wells[m]);
      draw(game.wells[m]);
    }
  }

  function tick() {
    if (!game || !document.body.contains(game.scene)) return stop();
    var now = Date.now();
    for (var i = 0; i < game.wells.length; i++) {
      var w = game.wells[i];
      if (!w.alive || !w.piece || now < w.dropAt) continue;
      if (fits(w, w.piece.cells, w.piece.x, w.piece.y + 1)) w.piece.y++;
      else lock(w);
      w.dropAt = now + interval(w);
      draw(w);
    }
    report();
  }

  // Wells that topped out in this tick go to the hub in one report (TVKit.report).
  function report() {
    if (game.timer && K.report(game, game.wells)) stop();
  }

  function startRun() {
    if (game.timer) return;
    for (var i = 0; i < game.wells.length; i++) if (game.wells[i].alive) spawn(game.wells[i]);
    for (var j = 0; j < game.wells.length; j++) draw(game.wells[j]);
    report();
    game.timer = setInterval(tick, 40);
  }

  function stop() {
    if (game && game.timer) clearInterval(game.timer);
    if (game) game.timer = null;
  }

  // A button on a phone: { t: "input", id, run, move: left | right | rotate | down | drop }.
  function onEvent(event) {
    if (!game || !game.timer || event.t !== "input" || event.run !== game.run) return;
    var w = null;
    for (var i = 0; i < game.wells.length; i++) if (game.wells[i].id === event.id) w = game.wells[i];
    if (!w || !w.alive || !w.piece) return;
    var p = w.piece;
    if (event.move === "left" || event.move === "right") {
      var dx = event.move === "left" ? -1 : 1;
      if (fits(w, p.cells, p.x + dx, p.y)) p.x += dx;
    } else if (event.move === "rotate" && p.type !== "O") {
      var turned = rotated(p.cells, p.size);
      var kicks = [0, -1, 1, -2, 2];
      for (var k = 0; k < kicks.length; k++) {
        if (fits(w, turned, p.x + kicks[k], p.y)) {
          p.cells = turned;
          p.x += kicks[k];
          break;
        }
      }
    } else if (event.move === "down") {
      if (fits(w, p.cells, p.x, p.y + 1)) {
        p.y++;
        w.score += 1;
        w.dropAt = Date.now() + interval(w);
      }
    } else if (event.move === "drop") {
      var rows = 0;
      while (fits(w, p.cells, p.x, p.y + 1)) {
        p.y++;
        rows++;
      }
      w.score += rows;
      lock(w);
    }
    draw(w);
    report();
  }

  function render(box, view) {
    if (!game || game.run !== view.run || game.seed !== view.seed || !box.contains(game.scene)) {
      stop();
      build(box, view);
      shown = { run: 0, seed: 0, phase: "" };
    }
    if (shown.run !== view.run || shown.seed !== view.seed || shown.phase !== view.phase) {
      shown = { run: view.run, seed: view.seed, phase: view.phase };
      K.overlay(game.over, view, { hint: "Left, right, turn and drop on your phone", unit: "points" });
      if (view.phase === "playing") startRun();
      if (view.phase === "final") stop();
    }
    if (game.side) K.side(game.side, view, { title: "PLAYERS", inText: "playing" });
  }

  window.TVGAMES.blocks = { render: render, onEvent: onEvent, okText: "Play again" };
})();
