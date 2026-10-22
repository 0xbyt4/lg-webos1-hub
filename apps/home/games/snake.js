// Snake Arena, TV part (ES5, WebKit 537). The board runs here: the hub sends each turn at
// once (onEvent) and this page reports who is out (TVHub.report).
// Light on the TV: the board moves in steps (about 8 a second), and a step moves only the
// tail element of each snake to the new head place (-webkit-transform), so the number of
// changed elements stays near the number of snakes.
(function () {
  var K = window.TVKit;
  var CELL = 40, COLS = 44, ROWS = 20, LEFT = 80, TOP = 150, START_LENGTH = 4;
  var SOLO_STEP = 150, SOLO_MIN_STEP = 80, TOGETHER_STEP = 125, FADE_MS = 1200;
  var MOVES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
  var CSS = [
    ".sn-scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background: #101113; }",
    ".sn-board { position: absolute; left: " + LEFT + "px; top: " + TOP + "px; width: " + (COLS * CELL) + "px; height: " + (ROWS * CELL) + "px;",
    "  background-color: #15171a; background-image: -webkit-linear-gradient(left, rgba(255,255,255,.035) 1px, transparent 1px),",
    "  -webkit-linear-gradient(top, rgba(255,255,255,.035) 1px, transparent 1px); background-size: " + CELL + "px " + CELL + "px;",
    "  border-radius: 6px; box-shadow: 0 0 0 6px #22252a; }",
    ".sn-seg { position: absolute; left: 0; top: 0; width: " + (CELL - 4) + "px; height: " + (CELL - 4) + "px; border-radius: 9px; }",
    ".sn-seg.head { border-radius: 14px; box-shadow: inset 0 0 0 4px rgba(255,255,255,.75); }",
    ".sn-out .sn-seg { opacity: .25; }",
    ".sn-food { position: absolute; left: 0; top: 0; width: 26px; height: 26px; border-radius: 13px; background: #e5484d;",
    "  box-shadow: 0 0 0 5px rgba(229,72,77,.25); }",
    ".sn-tag { position: absolute; left: 0; top: 0; font-size: 26px; font-weight: 600; color: #f3f3f1; white-space: nowrap;",
    "  padding: 4px 12px; border-radius: 10px; background: rgba(16,17,19,.8); }",
    ".sn-bar { position: absolute; right: 80px; top: 78px; text-align: right; white-space: nowrap; font-size: 30px; color: #8d929a; }",
    ".sn-chip { display: inline-block; margin-left: 30px; color: #f3f3f1; }",
    ".sn-chip.out { opacity: .4; }",
    ".sn-chip i { display: inline-block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; vertical-align: top; font-style: normal; }",
    ".sn-chip b { margin-left: 10px; font-weight: 600; }",
    ".sn-bar .big { color: #f3f3f1; font-weight: 600; }"
  ].join("\n");

  var game = null; // the run on screen
  var shown = { run: 0, seed: 0, phase: "" };

  function place(node, x, y, offset) {
    node.style.webkitTransform = "translate(" + (x * CELL + offset) + "px," + (y * CELL + offset) + "px)";
  }

  function addSeg(s, x, y, atHead) {
    var node = K.el("div", "sn-seg");
    node.style.background = s.color;
    place(node, x, y, 2);
    s.group.appendChild(node);
    var seg = { x: x, y: y, node: node };
    if (atHead) s.body.unshift(seg);
    else s.body.push(seg);
  }

  function setHead(s) {
    if (s.headNode) s.headNode.className = "sn-seg";
    s.headNode = s.body[0].node;
    s.headNode.className = "sn-seg head";
  }

  // Snakes start on rows spread over the board, every second one from the right side.
  function makeSnake(racer, i, n) {
    var y = Math.round((i + 1) * ROWS / (n + 1));
    var right = i % 2 === 0;
    var s = { id: racer.id, name: racer.name, color: racer.color, alive: racer.alive, score: racer.score,
      dir: right ? "right" : "left", turns: [], body: [], group: K.el("div"), headNode: null, goneAt: 0 };
    var x0 = right ? 4 + START_LENGTH : COLS - 5 - START_LENGTH;
    for (var k = 0; k < START_LENGTH; k++) addSeg(s, right ? x0 - k : x0 + k, y, false);
    setHead(s);
    return s;
  }

  function step() {
    if (!game || !document.body.contains(game.scene)) return stop();
    var now = Date.now();
    var i, s, k;
    // Snakes that went out fade and then leave the board.
    for (i = 0; i < game.snakes.length; i++) {
      s = game.snakes[i];
      if (!s.alive && s.goneAt && now >= s.goneAt && s.group.parentNode) {
        s.group.parentNode.removeChild(s.group);
        s.body = [];
      }
    }
    var occupied = {}, heads = {}, live = [];
    for (i = 0; i < game.snakes.length; i++) {
      s = game.snakes[i];
      if (!s.alive) {
        for (k = 0; k < s.body.length; k++) occupied[s.body[k].x + "," + s.body[k].y] = true;
        continue;
      }
      while (s.turns.length) {
        var turn = s.turns.shift();
        if (turn !== OPPOSITE[s.dir] && turn !== s.dir) {
          s.dir = turn;
          break;
        }
      }
      var m = MOVES[s.dir];
      s.nx = s.body[0].x + m[0];
      s.ny = s.body[0].y + m[1];
      s.eats = foodAt(s.nx, s.ny) >= 0;
      // The tail moves away in this step unless the snake eats.
      for (k = 0; k < s.body.length - (s.eats ? 0 : 1); k++) occupied[s.body[k].x + "," + s.body[k].y] = true;
      heads[s.nx + "," + s.ny] = (heads[s.nx + "," + s.ny] || 0) + 1;
      live.push(s);
    }
    var crashed = false;
    for (i = 0; i < live.length; i++) {
      s = live[i];
      var key = s.nx + "," + s.ny;
      if (s.nx < 0 || s.ny < 0 || s.nx >= COLS || s.ny >= ROWS || occupied[key] || heads[key] > 1) {
        out(s, now);
        crashed = true;
        continue;
      }
      if (s.eats) {
        var eaten = game.food.splice(foodAt(s.nx, s.ny), 1)[0];
        eaten.node.style.display = "none";
        game.spare.push(eaten.node);
        addSeg(s, s.nx, s.ny, true);
        s.score++;
        K.sound("tap");
      } else {
        var tail = s.body.pop();
        tail.x = s.nx;
        tail.y = s.ny;
        place(tail.node, s.nx, s.ny, 2);
        s.body.unshift(tail);
      }
      setHead(s);
    }
    if (crashed) K.sound("wrong");
    refillFood();
    drawBar();
    report();
    if (game.timer !== null) game.timer = setTimeout(step, stepMs());
  }

  function stepMs() {
    if (!game.solo) return TOGETHER_STEP;
    return Math.max(SOLO_MIN_STEP, SOLO_STEP - game.snakes[0].score * 3);
  }

  function out(s, now) {
    s.alive = false;
    s.goneAt = now + FADE_MS;
    s.group.className = "sn-out";
    game.crashes.push({ id: s.id, score: s.score });
  }

  function foodAt(x, y) {
    for (var i = 0; i < game.food.length; i++) if (game.food[i].x === x && game.food[i].y === y) return i;
    return -1;
  }

  function taken(x, y) {
    if (foodAt(x, y) >= 0) return true;
    for (var i = 0; i < game.snakes.length; i++) {
      var body = game.snakes[i].body;
      for (var k = 0; k < body.length; k++) if (body[k].x === x && body[k].y === y) return true;
    }
    return false;
  }

  // One apple more than there are snakes; the elements are used again, not made again.
  function refillFood() {
    var want = game.snakes.length + 1;
    var tries = 0;
    while (game.food.length < want && tries++ < 60) {
      var x = Math.floor(game.rand() * COLS), y = Math.floor(game.rand() * ROWS);
      if (taken(x, y)) continue;
      var node = game.spare.pop() || K.el("div", "sn-food");
      node.style.display = "block";
      node.style.webkitTransform = "translate(" + (x * CELL + 7) + "px," + (y * CELL + 7) + "px)";
      if (!node.parentNode) game.board.appendChild(node);
      game.food.push({ x: x, y: y, node: node });
    }
  }

  // Top right: the score and the best in Solo, every snake and its apples in Together.
  function drawBar() {
    var text = game.snakes.map(function (s) { return s.alive + ":" + s.score; }).join("|");
    if (text === game.barText) return;
    game.barText = text;
    K.clear(game.bar);
    if (game.solo) {
      var best = game.records && game.records.length ? game.records[0].value : 0;
      game.bar.appendChild(document.createTextNode("Apples "));
      game.bar.appendChild(K.el("span", "big", game.snakes[0].score));
      game.bar.appendChild(document.createTextNode("   Best " + best));
      return;
    }
    for (var i = 0; i < game.snakes.length; i++) {
      var s = game.snakes[i];
      var chip = K.el("span", "sn-chip" + (s.alive ? "" : " out"));
      chip.appendChild(K.dot(s.color));
      chip.appendChild(K.el("i", null, s.name));
      chip.appendChild(K.el("b", null, s.score));
      game.bar.appendChild(chip);
    }
  }

  // Snakes that went out in this step go to the hub in one report (TVKit.report).
  function report() {
    if (K.report(game, game.snakes)) stop();
  }

  function build(box, view) {
    K.clear(box);
    box.appendChild(K.style(CSS));
    var scene = K.el("div", "sn-scene");
    box.appendChild(scene);
    var solo = view.mode === "solo";
    game = { run: view.run, seed: view.seed, solo: solo, scene: scene, snakes: [], food: [], spare: [], crashes: [],
      timer: null, rand: K.random(view.seed), records: view.records, barText: "" };
    scene.appendChild(K.el("div", "label kt-label", "SNAKE ARENA · " + (solo ? "SOLO" : "TOGETHER") + " · GAME " + view.run));
    game.bar = K.el("div", "sn-bar");
    scene.appendChild(game.bar);
    game.board = K.el("div", "sn-board");
    scene.appendChild(game.board);
    game.tags = K.el("div");
    for (var i = 0; i < view.racers.length; i++) {
      var s = makeSnake(view.racers[i], i, view.racers.length);
      game.snakes.push(s);
      if (!s.alive) {
        s.body = []; // out before a page reload
        continue;
      }
      game.board.appendChild(s.group);
      var tag = K.el("div", "sn-tag");
      tag.appendChild(K.dot(s.color));
      tag.appendChild(document.createTextNode(s.name));
      var hx = s.body[0].x, hy = s.body[0].y;
      tag.style.webkitTransform = "translate(" + (s.dir === "right" ? hx * CELL + 56 : Math.max(0, hx * CELL - 280)) + "px," + (hy * CELL - 2) + "px)";
      game.tags.appendChild(tag);
    }
    game.board.appendChild(game.tags);
    refillFood();
    drawBar();
    game.over = K.el("div", "kt-over");
    scene.appendChild(game.over);
  }

  function startRun() {
    if (game.timer !== null) return;
    game.tags.style.display = "none";
    game.timer = setTimeout(step, stepMs());
  }

  function stop() {
    if (game && game.timer !== null) clearTimeout(game.timer);
    if (game) game.timer = null;
  }

  // A turn on a phone: { t: "input", id, run, dir: up | down | left | right }. Up to three
  // turns wait for the next steps, so a quick double turn is not lost.
  function onEvent(event) {
    if (!game || game.timer === null || event.t !== "input" || event.run !== game.run || !MOVES[event.dir]) return;
    for (var i = 0; i < game.snakes.length; i++) {
      var s = game.snakes[i];
      if (s.id !== event.id || !s.alive) continue;
      var last = s.turns.length ? s.turns[s.turns.length - 1] : s.dir;
      if (event.dir !== last && event.dir !== OPPOSITE[last] && s.turns.length < 3) s.turns.push(event.dir);
    }
  }

  function render(box, view) {
    if (!game || game.run !== view.run || game.seed !== view.seed || !box.contains(game.scene)) {
      stop();
      build(box, view);
      shown = { run: 0, seed: 0, phase: "" };
    }
    game.records = view.records;
    if (shown.run !== view.run || shown.seed !== view.seed || shown.phase !== view.phase) {
      shown = { run: view.run, seed: view.seed, phase: view.phase };
      K.overlay(game.over, view, { hint: "Steer with the arrows or swipe on your phone", unit: "apples" });
      if (view.phase === "playing") startRun();
      if (view.phase === "final") stop();
    }
  }

  window.TVGAMES.snake = { render: render, onEvent: onEvent, okText: "Play again" };
})();
