// Sky Hop, phone part: the whole screen is one hop button. The bird flies on the TV.
(function () {
  const STYLE = `
    .hp { flex: 1; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
    .hp .info { text-align: center; min-height: 56px; }
    .hp .info b { display: block; font-size: 22px; }
    .hp .btn {
      flex: 1; min-height: 300px; border-radius: 28px; font-size: 40px; font-weight: 700; color: #fff;
      background: #3a3f47; border: 0; touch-action: none; transition: transform .05s;
    }
    .hp .btn:active { transform: scale(.98); }
    .hp .btn.go { background: #4f8cff; }
    .hp .btn.out { background: #262a30; color: #8b919a; font-size: 26px; }
  `;
  let built = null;
  let last = { run: 0, phase: "", alive: true };
  const sound = (name) => window.PhoneSound && PhoneSound.play(name);

  function build(box, send) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const wrap = document.createElement("div");
    wrap.className = "hp";
    const info = document.createElement("div");
    info.className = "info";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    // pointerdown: a hop must not wait for the finger to lift.
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!btn.classList.contains("go")) return;
      if (navigator.vibrate) navigator.vibrate(10);
      sound("tap");
      send({ hop: true });
    });
    wrap.append(style, info, btn);
    box.replaceChildren(wrap);
    return { box, info, btn };
  }

  function nth(n) {
    return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  }

  window.GAMES.hop = {
    render(box, view, send) {
      if (!built || built.box !== box || !box.contains(built.btn)) built = build(box, send);
      const { info, btn } = built;
      if (view.run !== last.run || view.phase !== last.phase || view.alive !== last.alive) {
        if (view.phase === "playing" && last.phase !== "playing") sound("go");
        if (view.phase === "playing" && last.alive && !view.alive && view.run === last.run) sound("wrong");
        if (view.phase === "final" && (view.place === 1 || view.newRecord === 1)) sound("win");
      }
      last = { run: view.run, phase: view.phase, alive: view.alive };
      info.replaceChildren();
      const title = document.createElement("b");
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = "Run " + view.run + (view.mode === "solo" ? " · Solo" : " · " + view.players + " birds");
      info.append(title, sub);
      btn.className = "btn";
      if (!view.inRun) {
        title.textContent = "You fly in the next run";
        btn.classList.add("out");
        btn.textContent = "Watch the TV";
      } else if (view.phase === "countdown") {
        title.textContent = "Get ready";
        btn.textContent = "Wait...";
      } else if (view.phase === "playing" && view.alive) {
        title.textContent = "Tap to hop!";
        btn.classList.add("go");
        btn.textContent = "HOP";
      } else if (view.phase === "playing") {
        title.textContent = "You crashed";
        btn.classList.add("out");
        btn.textContent = view.score + " pipes";
      } else {
        title.textContent = view.mode === "solo" ? (view.newRecord === 1 ? "New record!" : view.score + " pipes")
          : view.place === 1 ? "You won!" : "You were " + nth(view.place);
        btn.classList.add("out");
        btn.textContent = view.score + " pipes";
      }
    }
  };
})();
