// Quiz, TV part (ES5, WebKit 537): the question with four colored choices and a countdown,
// then the right answer, a short fact and the points, and at the end the standings
// (Together) or the score and the best scores (Solo). Sounds mark each step.
(function () {
  var LETTERS = ["A", "B", "C", "D"];
  var COLORS = ["#e5484d", "#4f8cff", "#f2b24c", "#3fb27f"];
  var STYLE = [
    ".qz-top { position: absolute; left: 112px; top: 92px; width: 1696px; }",
    ".qz-top .count { position: absolute; right: 0; top: 0; font-size: 30px; color: #8d929a; }",
    ".qz-q { position: absolute; left: 112px; top: 190px; width: 1696px; font-size: 58px; font-weight: 300; line-height: 1.25; }",
    ".qz-choices { position: absolute; left: 112px; top: 470px; width: 1696px; font-size: 0; }",
    ".qz-c { display: inline-block; vertical-align: top; width: 834px; height: 150px; margin: 0 28px 28px 0; padding: 0 30px;",
    "  -webkit-box-sizing: border-box; box-sizing: border-box; background: #1a1c20; border: 4px solid transparent; border-radius: 22px;",
    "  font-size: 40px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 142px; }",
    ".qz-c:nth-child(2n) { margin-right: 0; }",
    ".qz-c b { display: inline-block; width: 64px; height: 64px; line-height: 64px; margin-right: 26px; border-radius: 16px;",
    "  text-align: center; color: #101113; font-weight: 700; font-size: 36px; vertical-align: 4px; }",
    ".qz-c.right { border-color: #3fb27f; background: #1d2a23; }",
    ".qz-c.dim { opacity: .35; }",
    ".qz-bar { position: absolute; left: 112px; top: 850px; width: 1696px; height: 8px; background: #25272b; border-radius: 4px; }",
    ".qz-bar i { position: absolute; left: 0; top: 0; height: 8px; background: #f2b24c; border-radius: 4px; }",
    ".qz-info { position: absolute; left: 112px; top: 884px; width: 1696px; font-size: 32px; color: #8d929a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".qz-chip { display: inline-block; margin-right: 40px; color: #f3f3f1; }",
    ".qz-dot { display: inline-block; width: 20px; height: 20px; border-radius: 10px; margin-right: 14px; vertical-align: 0; }",
    ".qz-big { position: absolute; left: 112px; top: 250px; width: 1696px; font-size: 96px; font-weight: 300; line-height: 1.15; }",
    ".qz-sub { position: absolute; left: 112px; top: 400px; width: 1696px; font-size: 40px; color: #8d929a; line-height: 1.4; }",
    ".qz-list { position: absolute; left: 112px; top: 480px; width: 1100px; }",
    ".qz-row { margin-top: 16px; font-size: 40px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".qz-row b { display: inline-block; width: 180px; color: #f2b24c; font-weight: 600; }",
    ".qz-rec { position: absolute; left: 1300px; top: 480px; width: 508px; }",
    ".qz-new { color: #f2b24c; font-weight: 600; }"
  ].join("\n");

  var last = { phase: "", number: 0 };
  var timer = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.appendChild(document.createTextNode(String(text)));
    return e;
  }

  function dot(color) {
    var d = el("span", "qz-dot");
    d.style.background = color;
    return d;
  }

  function sounds(view) {
    if (view.phase === last.phase && view.number === last.number) return;
    if (view.phase === "question") TVSound.play("question");
    else if (view.phase === "reveal") TVSound.play("correct");
    else if (view.phase === "final") TVSound.play(view.newRecord === 1 ? "record" : "win");
    else if (view.phase === "error") TVSound.play("wrong");
    last = { phase: view.phase, number: view.number };
  }

  // The countdown runs here between updates from the hub; the last 5 seconds tick.
  function countdown(bar, msLeft) {
    clearInterval(timer);
    var ends = Date.now() + msLeft, lastSecond = -1;
    function step() {
      if (!document.body.contains(bar)) return clearInterval(timer); // the screen changed
      var left = Math.max(0, ends - Date.now());
      bar.style.width = Math.round(1696 * left / 20000) + "px";
      var second = Math.ceil(left / 1000);
      if (second !== lastSecond && second > 0 && second <= 5) TVSound.play("tick");
      lastSecond = second;
      if (!left) clearInterval(timer);
    }
    step();
    timer = setInterval(step, 200);
  }

  function header(box, view, right) {
    var top = el("div", "qz-top");
    top.appendChild(el("div", "label", "QUIZ · " + view.topic.toUpperCase() + " · " + (view.mode === "solo" ? "SOLO" : "TOGETHER")));
    if (right) top.appendChild(el("div", "count", right));
    box.appendChild(top);
  }

  function renderQuestion(box, view) {
    header(box, view, "Question " + view.number + " of " + view.total);
    box.appendChild(el("div", "qz-q", view.question));
    var grid = el("div", "qz-choices");
    for (var i = 0; i < 4; i++) {
      var c = el("div", "qz-c");
      if (view.phase === "reveal") c.className += i === view.answer ? " right" : " dim";
      var letter = el("b", null, LETTERS[i]);
      letter.style.background = COLORS[i];
      c.appendChild(letter);
      c.appendChild(document.createTextNode(view.choices[i]));
      grid.appendChild(c);
    }
    box.appendChild(grid);
    var info = el("div", "qz-info");
    if (view.phase === "question") {
      var bar = el("div", "qz-bar"), fill = el("i");
      bar.appendChild(fill);
      box.appendChild(bar);
      countdown(fill, view.msLeft);
      var answered = view.answered.length;
      info.appendChild(document.createTextNode(answered ? "Answered: " : "Answer on your phone"));
      for (var a = 0; a < view.scores.length; a++) {
        if (view.answered.indexOf(view.scores[a].id) < 0) continue;
        var chip = el("span", "qz-chip");
        chip.appendChild(dot(view.scores[a].color));
        chip.appendChild(document.createTextNode(view.scores[a].name));
        info.appendChild(chip);
      }
    } else {
      clearInterval(timer);
      info.appendChild(el("div", null, view.fact));
      var line = el("div");
      line.style.marginTop = "16px";
      if (!view.results.length) line.appendChild(document.createTextNode("Nobody answered"));
      for (var r = 0; r < view.results.length; r++) {
        var res = view.results[r];
        var rc = el("span", "qz-chip");
        rc.appendChild(dot(res.color));
        rc.appendChild(document.createTextNode(res.name + (res.points ? "  +" + res.points : "  ✗")));
        line.appendChild(rc);
      }
      info.appendChild(line);
    }
    box.appendChild(info);
  }

  function renderFinal(box, view) {
    clearInterval(timer);
    header(box, view, null);
    var solo = view.mode === "solo";
    var top = view.scores[0];
    box.appendChild(el("div", "qz-big", solo ? (top ? top.score : 0) + " points" : (top ? top.name + " wins!" : "Game over")));
    var sub = el("div", "qz-sub");
    if (solo && view.newRecord === 1) sub.appendChild(el("span", "qz-new", "New record!"));
    else if (solo && view.newRecord) sub.appendChild(el("span", "qz-new", "Place " + view.newRecord + " in the best scores"));
    else sub.appendChild(document.createTextNode(solo ? "Well played" : "Final standings"));
    box.appendChild(sub);
    var list = el("div", "qz-list");
    for (var i = 0; i < view.scores.length && i < 8; i++) {
      var row = el("div", "qz-row");
      row.appendChild(el("b", null, view.scores[i].score));
      row.appendChild(dot(view.scores[i].color));
      row.appendChild(document.createTextNode(view.scores[i].name));
      list.appendChild(row);
    }
    box.appendChild(list);
    if (solo) {
      var rec = el("div", "qz-rec");
      rec.appendChild(el("div", "label", "BEST SCORES"));
      var records = view.records || [];
      for (var k = 0; k < records.length; k++) {
        rec.appendChild(el("div", "qz-row", (k + 1) + ". " + records[k].name + "  " + records[k].value));
      }
      box.appendChild(rec);
    }
  }

  function render(box, view) {
    sounds(view);
    while (box.firstChild) box.removeChild(box.firstChild);
    var style = el("style");
    style.appendChild(document.createTextNode(STYLE));
    box.appendChild(style);
    if (view.phase === "loading") {
      clearInterval(timer);
      header(box, view, null);
      box.appendChild(el("div", "qz-big", "Claude is writing the questions..."));
      box.appendChild(el("div", "qz-sub", "Topic: " + view.topic + ". This takes a few seconds."));
    } else if (view.phase === "error") {
      clearInterval(timer);
      header(box, view, null);
      box.appendChild(el("div", "qz-big", "The questions could not be made"));
      box.appendChild(el("div", "qz-sub", view.error + ". Press Back and try again."));
    } else if (view.phase === "final") {
      renderFinal(box, view);
    } else {
      renderQuestion(box, view);
    }
  }

  window.TVGAMES.quiz = { render: render, okText: "Next" };
})();
