// Shared parts of the TV games that run on the screen (ES5, WebKit 537): elements, a
// seeded random generator, the 3-2-1 countdown, the final screen, the side list and the
// reports to the hub.
// Used by Block Drop and Snake Arena.
(function () {
  var STYLE = [
    ".kt-side { position: absolute; right: 92px; top: 72px; width: 440px; padding: 14px 20px 20px; border-radius: 16px; background: rgba(16, 17, 19, .7); }",
    ".kt-row { margin-top: 12px; font-size: 32px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f3f3f1; }",
    ".kt-row.out { opacity: .45; }",
    ".kt-row em { float: right; font-style: normal; font-weight: 600; }",
    ".kt-dot { display: inline-block; width: 20px; height: 20px; border-radius: 10px; margin-right: 14px; vertical-align: 0; }",
    ".kt-label { position: absolute; left: 92px; top: 72px; padding: 14px 20px; border-radius: 14px; background: rgba(16, 17, 19, .7); }",
    ".kt-over { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; text-align: center; display: none; }",
    ".kt-over .big { margin-top: 300px; font-size: 140px; font-weight: 300; color: #f3f3f1; }",
    ".kt-over .sub { margin-top: 24px; font-size: 40px; color: #f2b24c; }",
    ".kt-over .list { margin: 40px auto 0; width: 900px; text-align: left; }"
  ].join("\n");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(String(text)));
    return e;
  }

  function dot(color) {
    var d = el("span", "kt-dot");
    d.style.background = color;
    return d;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // A style element with the shared rules plus the game's own.
  function style(css) {
    var s = el("style");
    s.appendChild(document.createTextNode(STYLE + "\n" + css));
    return s;
  }

  // Park-Miller random numbers in [0, 1): exact in doubles, so no Math.imul (not here).
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

  function nth(n) {
    return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  }

  // The list on the right: best scores in Solo, the players and their state in Together.
  // opts: { title, unit, inText }
  function side(node, view, opts) {
    clear(node);
    if (view.mode === "solo") {
      node.appendChild(el("div", "label", "BEST SCORES"));
      var records = view.records || [];
      if (!records.length) node.appendChild(el("div", "kt-row", "No scores yet"));
      for (var i = 0; i < records.length; i++) {
        var r = el("div", "kt-row", (i + 1) + ". " + records[i].name);
        r.appendChild(el("em", null, records[i].value));
        node.appendChild(r);
      }
      return;
    }
    node.appendChild(el("div", "label", opts.title));
    for (var j = 0; j < view.standings.length; j++) {
      var s = view.standings[j];
      var row = el("div", "kt-row" + (s.alive ? "" : " out"));
      row.appendChild(dot(s.color));
      row.appendChild(document.createTextNode(s.name));
      row.appendChild(el("em", null, s.alive ? opts.inText : s.score));
      node.appendChild(row);
    }
  }

  // The countdown (phase "countdown") or the final screen (phase "final") on top of the game.
  // opts: { hint, unit }. Returns true while the overlay covers the game.
  function overlay(node, view, opts) {
    clear(node);
    if (view.phase === "countdown") {
      node.style.display = "block";
      node.style.background = "rgba(16, 17, 19, .45)";
      var n = el("div", "big", "3");
      node.appendChild(n);
      node.appendChild(el("div", "sub", opts.hint));
      var started = Date.now();
      sound("tick");
      (function count() {
        if (!document.body.contains(n) || node.style.display === "none") return;
        var left = 3 - Math.floor((Date.now() - started) / 1000);
        if (left >= 1) {
          if (n.textContent !== String(left)) sound("tick");
          n.textContent = String(left);
          setTimeout(count, 100);
        }
      })();
      return true;
    }
    if (view.phase !== "final") {
      node.style.display = "none";
      return false;
    }
    node.style.display = "block";
    node.style.background = "rgba(16, 17, 19, .82)";
    var top = view.standings[0];
    if (view.mode === "solo") {
      node.appendChild(el("div", "big", (top ? top.score : 0) + " " + opts.unit));
      node.appendChild(el("div", "sub", view.newRecord === 1 ? "New record!" : view.newRecord ? "Place " + view.newRecord + " in the best scores" : "Press OK to play again"));
      sound(view.newRecord === 1 ? "record" : "win");
    } else {
      node.appendChild(el("div", "big", top ? top.name + " wins!" : "Game over"));
      node.appendChild(el("div", "sub", "Press OK to play again"));
      var list = el("div", "list");
      for (var i = 0; i < view.standings.length && i < 8; i++) {
        var s = view.standings[i];
        var row = el("div", "kt-row");
        row.appendChild(dot(s.color));
        row.appendChild(document.createTextNode(nth(i + 1) + "  " + s.name + "  ·  " + s.score + " " + opts.unit));
        if (s.wins) row.appendChild(el("em", null, s.wins + (s.wins === 1 ? " win" : " wins")));
        list.appendChild(row);
      }
      node.appendChild(list);
      sound("win");
    }
    return true;
  }

  var SCORES_MS = 10000;

  // Reports what happened on the TV. game: { run, crashes: [{ id, score }] new since the
  // last call }; players: [{ id, alive, score }]. Together ends when one player is left,
  // or with untilLast (Sky Hop) when the last one is out too.
  // The end report lists every player who is out, so a lost earlier report does not make
  // that player a winner. Every 10 s the scores of the players still in go to the hub
  // too, so a run the hub ends after its time limit keeps the real scores.
  // Returns true when the run is over.
  function report(game, players, untilLast) {
    var now = Date.now();
    var left = players.filter(function (p) { return p.alive; });
    if (game.crashes.length) {
      var over = !left.length || (!untilLast && players.length > 1 && left.length === 1);
      var crashes = !over ? game.crashes : players.filter(function (p) { return !p.alive; }).map(function (p) {
        return { id: p.id, score: p.score };
      });
      game.crashes = [];
      var final = left.map(function (p) { return { id: p.id, score: p.score }; });
      if (window.TVHub) TVHub.report({ run: game.run, crashes: crashes, over: over, final: final });
      if (over) for (var i = 0; i < left.length; i++) left[i].alive = false;
      return over;
    }
    if (!game.scoresAt) game.scoresAt = now; // the first update 10 s into the run
    if (now - game.scoresAt < SCORES_MS) return false;
    game.scoresAt = now;
    var scores = left.map(function (p) { return { id: p.id, score: p.score }; });
    var text = JSON.stringify(scores);
    if (text !== game.scoresText && window.TVHub) TVHub.report({ run: game.run, crashes: [], scores: scores });
    game.scoresText = text;
    return false;
  }

  window.TVKit = { el: el, dot: dot, clear: clear, style: style, random: random, sound: sound, side: side, overlay: overlay,
    report: report };
})();
