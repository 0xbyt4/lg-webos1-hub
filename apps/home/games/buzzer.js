// Buzzer, TV part (ES5, WebKit 537): "Get ready", a big "GO!", then who pressed first,
// with the reaction times and the scores (Together) or the best times (Solo).
// The hub sends the view; this only draws it, and plays a sound when the phase changes.
(function () {
  var STYLE = [
    ".bz-round { position: absolute; left: 112px; top: 92px; }",
    ".bz-main { position: absolute; left: 112px; top: 250px; width: 1100px; }",
    ".bz-big { font-size: 150px; font-weight: 300; line-height: 1.1; }",
    ".bz-go { font-size: 330px; font-weight: 700; color: #3fb27f; line-height: 1; letter-spacing: 6px; }",
    ".bz-sub { margin-top: 26px; font-size: 40px; color: #8d929a; }",
    ".bz-win { font-size: 84px; font-weight: 300; line-height: 1.2; }",
    ".bz-row { margin-top: 18px; font-size: 40px; white-space: nowrap; }",
    ".bz-row .ms { display: inline-block; width: 200px; color: #f2b24c; font-weight: 600; }",
    ".bz-early { margin-top: 34px; font-size: 32px; color: #e5484d; }",
    ".bz-scores { position: absolute; left: 1360px; top: 250px; width: 448px; }",
    ".bz-score { margin-top: 20px; font-size: 38px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".bz-score b { float: right; font-weight: 600; }",
    ".bz-dot { display: inline-block; width: 22px; height: 22px; border-radius: 11px; margin-right: 18px; vertical-align: -1px; }",
    ".bz-record { margin-top: 30px; font-size: 44px; color: #f2b24c; font-weight: 600; }"
  ].join("\n");
  var last = { phase: "", round: 0, early: 0 };

  // A sound for each change: GO, a result, a false start.
  function sounds(view) {
    if (view.phase !== last.phase || view.round !== last.round) {
      if (view.phase === "go") TVSound.play("go");
      else if (view.phase === "result") TVSound.play(view.newRecord === 1 ? "record" : view.results.length ? "win" : "wrong");
    }
    if (view.falseStarts.length > last.early) TVSound.play("wrong");
    last = { phase: view.phase, round: view.round, early: view.falseStarts.length };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(String(text)));
    return e;
  }

  function dot(color) {
    var d = el("span", "bz-dot");
    d.style.background = color;
    return d;
  }

  function render(box, view) {
    sounds(view);
    while (box.firstChild) box.removeChild(box.firstChild);
    var style = el("style");
    style.appendChild(document.createTextNode(STYLE));
    box.appendChild(style);

    var round = el("div", "bz-round");
    round.appendChild(el("div", "label", "BUZZER · " + (view.mode === "solo" ? "SOLO" : "TOGETHER") + " · ROUND " + view.round));
    box.appendChild(round);

    var main = el("div", "bz-main");
    if (view.phase === "go") {
      main.appendChild(el("div", "bz-go", "GO!"));
    } else if (view.phase === "result") {
      if (view.results.length && view.mode === "solo") {
        main.appendChild(el("div", "bz-win", view.results[0].ms + " ms"));
        if (view.newRecord === 1) main.appendChild(el("div", "bz-record", "New record!"));
        else if (view.newRecord) main.appendChild(el("div", "bz-record", "Place " + view.newRecord + " in the best times"));
        if (view.best !== null) main.appendChild(el("div", "bz-sub", "Your best this game: " + view.best + " ms"));
      } else if (view.results.length) {
        var first = view.results[0];
        main.appendChild(el("div", "bz-win", first.name + " was first"));
        for (var i = 0; i < view.results.length && i < 5; i++) {
          var r = view.results[i];
          var row = el("div", "bz-row");
          row.appendChild(el("span", "ms", r.ms + " ms"));
          row.appendChild(dot(r.color));
          row.appendChild(document.createTextNode(r.name));
          main.appendChild(row);
        }
      } else {
        main.appendChild(el("div", "bz-win", "Nobody pressed in time"));
      }
    } else {
      main.appendChild(el("div", "bz-big", "Get ready..."));
      main.appendChild(el("div", "bz-sub", "Press your phone when the TV says GO. Not before!"));
    }
    if (view.falseStarts.length) {
      main.appendChild(el("div", "bz-early", "Too early: " + view.falseStarts.map(function (f) { return f.name; }).join(", ")));
    }
    box.appendChild(main);

    var scores = el("div", "bz-scores");
    if (view.mode === "solo") {
      // Solo: the best times ever, instead of points.
      scores.appendChild(el("div", "label", "BEST TIMES"));
      var records = view.records || [];
      if (!records.length) scores.appendChild(el("div", "bz-score", "No times yet"));
      for (var k = 0; k < records.length; k++) {
        var rec = el("div", "bz-score");
        rec.appendChild(document.createTextNode((k + 1) + ". " + records[k].name));
        rec.appendChild(el("b", null, records[k].value + " ms"));
        scores.appendChild(rec);
      }
    } else {
      scores.appendChild(el("div", "label", "POINTS"));
      for (var j = 0; j < view.scores.length; j++) {
        var s = view.scores[j];
        var line = el("div", "bz-score");
        line.appendChild(dot(s.color));
        line.appendChild(document.createTextNode(s.name));
        line.appendChild(el("b", null, s.score));
        scores.appendChild(line);
      }
    }
    box.appendChild(scores);
  }

  window.TVGAMES.buzzer = { render: render, okText: "Next round" };
})();
