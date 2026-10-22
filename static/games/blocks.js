// Block Drop, phone part: five buttons. The well is on the TV.
// Left, right and down repeat while the finger stays on them.
(function () {
  const STYLE = `
    .bk { flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .bk .info { text-align: center; min-height: 56px; }
    .bk .info b { display: block; font-size: 22px; }
    .bk .pad { flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: 12px; min-height: 300px; }
    .bk .pad button {
      border-radius: 22px; border: 0; color: #fff; background: #3a3f47; font-size: 22px; font-weight: 700;
      touch-action: none; user-select: none; -webkit-user-select: none; transition: transform .05s;
    }
    .bk .pad button:active { transform: scale(.97); }
    .bk .pad button svg { width: 44px; height: 44px; display: block; margin: 0 auto 4px; }
    .bk .pad .rotate { grid-column: 1 / 4; background: #b07cf2; }
    .bk .pad .drop { grid-column: 1 / 4; background: #4f8cff; }
    .bk.off .pad button { background: #262a30; color: #8b919a; }
  `;
  const ICONS = {
    left: '<path d="M15 5l-7 7 7 7" />',
    right: '<path d="M9 5l7 7-7 7" />',
    down: '<path d="M5 9l7 7 7-7" />',
    rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4v4h-4" />',
    drop: '<path d="M6 5l6 6 6-6" /><path d="M6 12l6 6 6-6" />'
  };
  const LABELS = { left: "Left", right: "Right", down: "Down", rotate: "Turn", drop: "Drop" };
  const REPEAT = { left: true, right: true, down: true };
  let built = null;
  let last = { run: 0, phase: "", alive: true };
  const sound = (name) => window.PhoneSound && PhoneSound.play(name);

  function button(move, send, isOn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = move;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[move] + "</svg>" + LABELS[move];
    let timer = null;
    const release = () => { clearTimeout(timer); timer = null; };
    const fire = () => {
      if (!isOn()) return release();
      send({ move });
    };
    // pointerdown: a move must not wait for the finger to lift.
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!isOn()) return;
      if (navigator.vibrate) navigator.vibrate(8);
      fire();
      if (REPEAT[move]) {
        release();
        const again = () => { fire(); if (timer) timer = setTimeout(again, 75); };
        timer = setTimeout(again, 220);
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => b.addEventListener(t, release));
    return b;
  }

  function build(box, send) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const wrap = document.createElement("div");
    wrap.className = "bk";
    const info = document.createElement("div");
    info.className = "info";
    const pad = document.createElement("div");
    pad.className = "pad";
    const isOn = () => !wrap.classList.contains("off");
    ["rotate", "left", "down", "right", "drop"].forEach((m) => pad.appendChild(button(m, send, isOn)));
    wrap.append(style, info, pad);
    box.replaceChildren(wrap);
    return { box, wrap, info, pad };
  }

  function nth(n) {
    return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  }

  window.GAMES.blocks = {
    render(box, view, send) {
      if (!built || built.box !== box || !box.contains(built.pad)) built = build(box, send);
      const { wrap, info } = built;
      if (view.run !== last.run || view.phase !== last.phase || view.alive !== last.alive) {
        if (view.phase === "playing" && last.phase !== "playing") sound("go");
        if (view.phase === "playing" && last.alive && !view.alive && view.run === last.run) sound("wrong");
        if (view.phase === "final" && (view.place === 1 || view.newRecord === 1)) sound("win");
      }
      last = { run: view.run, phase: view.phase, alive: view.alive };
      const on = view.inRun && view.phase === "playing" && view.alive;
      wrap.classList.toggle("off", !on);
      info.replaceChildren();
      const title = document.createElement("b");
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = "Game " + view.run + (view.mode === "solo" ? " · Solo" : " · " + view.players + " players");
      info.append(title, sub);
      if (!view.inRun) title.textContent = "You play in the next game";
      else if (view.phase === "countdown") title.textContent = "Get ready";
      else if (on) title.textContent = "Watch your well on the TV";
      else if (view.phase === "playing") title.textContent = "Out with " + view.score + " points";
      else if (view.mode === "solo") title.textContent = view.newRecord === 1 ? "New record! " + view.score + " points" : view.score + " points";
      else title.textContent = view.place === 1 ? "You won!" : "You were " + nth(view.place);
    }
  };
})();
