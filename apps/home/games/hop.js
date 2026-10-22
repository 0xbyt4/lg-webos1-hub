// Sky Hop, TV part (ES5, WebKit 537). The physics and drawing run here: the hub sends each
// tap at once (onEvent) and this page reports crashes back (TVHub.report). Pipes come from
// a seeded random generator, so a run looks the same however often the page draws.
// Drawing uses positioned elements moved with -webkit-transform: measured on webOS 1.4 at
// about 46 frames a second, against 23 for a full-screen canvas.
(function () {
  var W = 1920, GROUND = 990, R = 28;
  var GRAVITY = 2600, HOP_SPEED = -840, MAX_FALL = 1300;
  var PIPE_W = 150, GAP = 330, SPACING = 540, SPEED = 380, SPEED_STEP = 6, MAX_SPEED = 580;
  var STYLE = [
    ".hp-scene { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; background: #13253f; }",
    ".hp-ground { position: absolute; left: 0; top: " + GROUND + "px; width: 1920px; height: 90px; background: #2a2d33; border-top: 6px solid #3a3e46; }",
    ".hp-pipe { position: absolute; left: 0; top: 0; width: " + PIPE_W + "px; height: 1080px; }",
    ".hp-pipe i { position: absolute; left: 0; width: " + PIPE_W + "px; background: #3fb27f; border: 6px solid #2e8a5e;",
    "  -webkit-box-sizing: border-box; box-sizing: border-box; }",
    ".hp-bird { position: absolute; left: 0; top: 0; width: " + (R * 2) + "px; height: " + (R * 2) + "px; border-radius: " + R + "px; }",
    ".hp-bird b { position: absolute; left: 32px; top: 12px; width: 14px; height: 14px; border-radius: 7px; background: #fff; }",
    ".hp-bird span { position: absolute; left: -60px; top: -40px; width: 176px; text-align: center; font-size: 24px; color: #f3f3f1; white-space: nowrap; }",
    ".hp-bird.out { opacity: .25; }",
    ".hp-score { position: absolute; left: 0; top: 70px; width: 1920px; text-align: center; font-size: 120px; font-weight: 600; color: #f3f3f1; }",
    // The label and the list stay readable when pipes pass behind them.
    ".hp-label { position: absolute; left: 92px; top: 72px; padding: 14px 20px; border-radius: 14px; background: rgba(16, 17, 19, .7); }",
    ".hp-side { position: absolute; right: 92px; top: 72px; width: 440px; padding: 14px 20px 20px; border-radius: 16px; background: rgba(16, 17, 19, .7); }",
    ".hp-row { margin-top: 12px; font-size: 32px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f3f3f1; }",
    ".hp-row.out { opacity: .45; }",
    ".hp-row em { float: right; font-style: normal; font-weight: 600; }",
    ".hp-dot { display: inline-block; width: 20px; height: 20px; border-radius: 10px; margin-right: 14px; vertical-align: 0; }",
    ".hp-over { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: rgba(16, 17, 19, .82); text-align: center; }",
    ".hp-over .big { margin-top: 300px; font-size: 140px; font-weight: 300; color: #f3f3f1; }",
    ".hp-over .sub { margin-top: 24px; font-size: 40px; color: #f2b24c; }",
    ".hp-over .list { margin: 40px auto 0; width: 900px; text-align: left; }"
  ].join("\n");

  var sim = null; // the run on screen
  var shown = { run: 0, phase: "" };
  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
    function (f) { return setTimeout(function () { f(); }, 16); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(String(text)));
    return e;
  }

  function dot(color) {
    var d = el("span", "hp-dot");
    d.style.background = color;
    return d;
  }

  function place(node, x, y) {
    node.style.webkitTransform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  }

  // Park-Miller random numbers: exact in doubles, so no Math.imul (not in this engine).
  function random(seed) {
    var s = seed % 2147483647 || 1;
    return function () {
      s = s * 16807 % 2147483647;
      return s / 2147483647;
    };
  }

  function sound(name) {
    if (window.TVSound) TVSound.play(name);
  }

  function buildScene(box, view) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var style = el("style");
    style.appendChild(document.createTextNode(STYLE));
    box.appendChild(style);
    var scene = el("div", "hp-scene");
    var pipesLayer = el("div");
    scene.appendChild(pipesLayer);
    scene.appendChild(el("div", "hp-ground"));
    var solo = view.mode === "solo";
    var birds = [];
    for (var i = 0; i < view.racers.length; i++) {
      var b = view.racers[i];
      var node = el("div", "hp-bird");
      node.style.background = b.color;
      node.appendChild(el("b"));
      if (!solo) node.appendChild(el("span", null, b.name));
      scene.appendChild(node);
      // Birds sit side by side in Together, so each one can be seen.
      // After a page reload mid-run, birds that already crashed stay down.
      if (!b.alive) node.className = "hp-bird out";
      birds.push({ id: b.id, x: 460 + i * 46, y: b.alive ? 420 + (i % 3) * 30 : GROUND - R, vy: 0, alive: b.alive, score: b.score, node: node });
    }
    var score = el("div", "hp-score", solo ? "0" : "");
    scene.appendChild(score);
    var label = el("div", "label hp-label", "SKY HOP · " + (solo ? "SOLO" : "TOGETHER") + " · RUN " + view.run);
    scene.appendChild(label);
    var side = el("div", "hp-side");
    scene.appendChild(side);
    var over = el("div", "hp-over");
    over.style.display = "none";
    scene.appendChild(over);
    box.appendChild(scene);
    sim = {
      run: view.run, seed: view.seed, solo: solo, crashes: [], rand: random(view.seed), scene: scene, pipesLayer: pipesLayer, pipes: [],
      birds: birds, scoreNode: score, side: side, over: over, running: false, last: 0, speed: SPEED, passed: 0
    };
    for (var j = 0; j < birds.length; j++) place(birds[j].node, birds[j].x - R, birds[j].y - R);
  }

  function addPipe(x) {
    var gapTop = 200 + Math.floor(sim.rand() * (GROUND - GAP - 360));
    var node = el("div", "hp-pipe");
    var top = el("i");
    top.style.top = "0px";
    top.style.height = gapTop + "px";
    var bottom = el("i");
    bottom.style.top = (gapTop + GAP) + "px";
    bottom.style.height = (GROUND - gapTop - GAP) + "px";
    node.appendChild(top);
    node.appendChild(bottom);
    sim.pipesLayer.appendChild(node);
    sim.pipes.push({ x: x, gapTop: gapTop, node: node, counted: false });
    place(node, x, 0);
  }

  function hits(b, p) {
    if (b.x + R < p.x || b.x - R > p.x + PIPE_W) return false;
    return b.y - R < p.gapTop || b.y + R > p.gapTop + GAP;
  }

  // Crashes of one frame go to the hub in one report (see step), so a tie stays a tie.
  function crash(b) {
    b.alive = false;
    b.node.className = "hp-bird out";
    sound("wrong");
    sim.crashes.push({ id: b.id, score: b.score });
  }

  // One clock for all timing: frame timestamps differ between old and new engines.
  function step() {
    if (!sim || !sim.running || !document.body.contains(sim.scene)) return;
    var now = Date.now();
    var dt = Math.min(0.05, (now - sim.last) / 1000);
    sim.last = now;
    var i, b, p;
    for (i = 0; i < sim.pipes.length; i++) {
      p = sim.pipes[i];
      p.x -= sim.speed * dt;
      place(p.node, p.x, 0);
    }
    if (sim.pipes.length && sim.pipes[0].x < -PIPE_W) {
      sim.pipesLayer.removeChild(sim.pipes[0].node);
      sim.pipes.shift();
    }
    var lastPipe = sim.pipes[sim.pipes.length - 1];
    if (!lastPipe || lastPipe.x < W - SPACING) addPipe(lastPipe ? lastPipe.x + SPACING : W + 200);
    var anyAlive = false;
    for (i = 0; i < sim.birds.length; i++) {
      b = sim.birds[i];
      if (!b.alive) {
        if (b.y < GROUND - R) b.y = Math.min(GROUND - R, b.y + 600 * dt);
        place(b.node, b.x - R, b.y - R);
        continue;
      }
      anyAlive = true;
      b.vy = Math.min(MAX_FALL, b.vy + GRAVITY * dt);
      b.y += b.vy * dt;
      if (b.y < R) {
        b.y = R;
        b.vy = 0;
      }
      place(b.node, b.x - R, b.y - R);
      if (b.y + R >= GROUND) {
        crash(b);
        continue;
      }
      for (var k = 0; k < sim.pipes.length; k++) {
        p = sim.pipes[k];
        if (hits(b, p)) {
          crash(b);
          break;
        }
      }
    }
    // A pipe counts once its right edge is past the whole bird in the first column.
    for (i = 0; i < sim.pipes.length; i++) {
      p = sim.pipes[i];
      if (p.counted || p.x + PIPE_W > 460 - R) continue;
      p.counted = true;
      sim.passed++;
      sim.speed = Math.min(MAX_SPEED, sim.speed + SPEED_STEP);
      for (var m = 0; m < sim.birds.length; m++) if (sim.birds[m].alive) sim.birds[m].score++;
      if (sim.solo && anyAlive) {
        sim.scoreNode.textContent = String(sim.birds[0].score);
        sound("tick");
      }
    }
    // The shared reports (apps/home/games/kit.js): crashes, the end, scores every 10 s.
    if (window.TVKit) TVKit.report(sim, sim.birds, true);
    if (anyAlive || sim.birds.some(function (x) { return x.y < GROUND - R; })) raf(step);
    else sim.running = false;
  }

  function startRun() {
    if (sim.running) return;
    sim.running = true;
    sim.last = Date.now();
    raf(step);
  }

  function sidebar(view) {
    var side = sim.side;
    while (side.firstChild) side.removeChild(side.firstChild);
    if (sim.solo) {
      side.appendChild(el("div", "label", "BEST SCORES"));
      var records = view.records || [];
      if (!records.length) side.appendChild(el("div", "hp-row", "No scores yet"));
      for (var i = 0; i < records.length; i++) {
        var r = el("div", "hp-row", (i + 1) + ". " + records[i].name);
        r.appendChild(el("em", null, records[i].value));
        side.appendChild(r);
      }
      return;
    }
    side.appendChild(el("div", "label", "BIRDS"));
    for (var j = 0; j < view.standings.length; j++) {
      var s = view.standings[j];
      var row = el("div", "hp-row" + (s.alive ? "" : " out"));
      row.appendChild(dot(s.color));
      row.appendChild(document.createTextNode(s.name));
      row.appendChild(el("em", null, s.alive ? "flying" : s.score));
      side.appendChild(row);
    }
  }

  function overlay(view) {
    var over = sim.over;
    while (over.firstChild) over.removeChild(over.firstChild);
    if (view.phase === "countdown") {
      over.style.display = "block";
      over.style.background = "rgba(16, 17, 19, .45)";
      var n = el("div", "big", "3");
      over.appendChild(n);
      over.appendChild(el("div", "sub", "Tap your phone to hop"));
      var started = Date.now();
      (function count() {
        if (!document.body.contains(n) || over.style.display === "none") return;
        var left = 3 - Math.floor((Date.now() - started) / 1000);
        if (left >= 1) {
          if (n.textContent !== String(left)) sound("tick");
          n.textContent = String(left);
          setTimeout(count, 100);
        }
      })();
      sound("tick");
      return;
    }
    if (view.phase !== "final") {
      over.style.display = "none";
      return;
    }
    over.style.display = "block";
    over.style.background = "rgba(16, 17, 19, .82)";
    var top = view.standings[0];
    if (sim.solo) {
      over.appendChild(el("div", "big", (top ? top.score : 0) + " points"));
      over.appendChild(el("div", "sub", view.newRecord === 1 ? "New record!" : view.newRecord ? "Place " + view.newRecord + " in the best scores" : "Press OK for another run"));
      sound(view.newRecord === 1 ? "record" : "win");
    } else {
      over.appendChild(el("div", "big", top ? top.name + " wins!" : "Run over"));
      over.appendChild(el("div", "sub", "Press OK for another run"));
      var list = el("div", "list");
      for (var i = 0; i < view.standings.length && i < 8; i++) {
        var s = view.standings[i];
        var row = el("div", "hp-row");
        row.appendChild(dot(s.color));
        row.appendChild(document.createTextNode((i + 1) + ". " + s.name + "  ·  " + s.score + " pipes"));
        if (s.wins) row.appendChild(el("em", null, s.wins + (s.wins === 1 ? " win" : " wins")));
        list.appendChild(row);
      }
      over.appendChild(list);
      sound("win");
    }
  }

  function render(box, view) {
    // A new game starts again at run 1, so the seed tells two runs apart too.
    if (!sim || sim.run !== view.run || sim.seed !== view.seed || !box.contains(sim.scene)) {
      if (sim) sim.running = false;
      buildScene(box, view);
      shown = { run: 0, phase: "" };
    }
    if (shown.run !== view.run || shown.phase !== view.phase) {
      shown = { run: view.run, phase: view.phase };
      overlay(view);
      if (view.phase === "playing") startRun();
      if (view.phase === "final") sim.running = false;
    }
    sidebar(view);
  }

  // A tap from a phone: { t: "input", id, run, hop: true }.
  function onEvent(event) {
    if (!sim || event.t !== "input" || !event.hop || event.run !== sim.run || !sim.running) return;
    for (var i = 0; i < sim.birds.length; i++) {
      var b = sim.birds[i];
      if (b.id === event.id && b.alive) {
        b.vy = HOP_SPEED; // the phone plays the tap sound; the TV stays quiet
      }
    }
  }

  window.TVGAMES.hop = { render: render, onEvent: onEvent, okText: "Next run" };
})();
