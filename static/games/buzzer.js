// Buzzer, phone part: one big button. The hub decides everything; this only draws the
// view it gets and sends {press: true}.
(function () {
  const STYLE = `
    .buzz { flex: 1; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
    .buzz .info { text-align: center; min-height: 52px; }
    .buzz .info b { display: block; font-size: 22px; }
    .buzz .btn {
      flex: 1; min-height: 260px; border-radius: 28px; font-size: 40px; font-weight: 700; color: #fff;
      background: #3a3f47; border: 0; touch-action: none; transition: transform .05s;
    }
    .buzz .btn:active { transform: scale(.98); }
    .buzz .btn.go { background: #30a46c; }
    .buzz .btn.done { background: #262a30; color: #8b919a; font-size: 26px; }
    .buzz .btn.early { background: #e5484d; font-size: 26px; }
  `;
  let built = null;
  let last = { phase: "", round: 0 };
  const sound = (name) => window.PhoneSound && PhoneSound.play(name);

  function build(box, send) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const wrap = document.createElement("div");
    wrap.className = "buzz";
    const info = document.createElement("div");
    info.className = "info";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    // pointerdown, not click: a click fires only when the finger lifts, which costs time.
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (navigator.vibrate) navigator.vibrate(15);
      sound("tap");
      send({ press: true });
    });
    wrap.append(style, info, btn);
    box.replaceChildren(wrap);
    return { box, info, btn };
  }

  function place(n) {
    return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  }

  window.GAMES.buzzer = {
    render(box, view, send) {
      if (!built || built.box !== box || !box.contains(built.btn)) built = build(box, send);
      if (view.phase !== last.phase || view.round !== last.round) {
        if (view.phase === "go") sound("go");
        if (view.phase === "result" && view.place === 1) sound("win");
      }
      last = { phase: view.phase, round: view.round };
      const { info, btn } = built;
      info.replaceChildren();
      const title = document.createElement("b");
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = view.mode === "solo"
        ? "Round " + view.round + (view.best != null ? " · your best: " + view.best + " ms" : "")
        : "Round " + view.round + " · your points: " + view.score;
      info.append(title, sub);
      btn.className = "btn";
      if (view.falseStart) {
        title.textContent = "Too early";
        btn.classList.add("early");
        btn.textContent = "Wait for the next round";
      } else if (view.pressed) {
        title.textContent = view.mode === "solo" ? (view.newRecord === 1 ? "New record!" : "Your time")
          : view.place === 1 ? "You were first!" : "You were " + place(view.place);
        btn.classList.add("done");
        btn.textContent = view.ms + " ms";
      } else if (view.phase === "go") {
        title.textContent = "Now!";
        btn.classList.add("go");
        btn.textContent = "PRESS";
      } else if (view.phase === "result") {
        title.textContent = "Too slow this time";
        btn.classList.add("done");
        btn.textContent = "Next round soon";
      } else {
        title.textContent = "Get ready";
        btn.textContent = "Wait for Go";
      }
    }
  };
})();
