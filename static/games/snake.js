// Snake Arena, phone part: four arrow buttons, or swipe anywhere on the pad.
// The snake moves on the TV.
(function () {
  const STYLE = `
    .sk { flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .sk .info { text-align: center; min-height: 56px; }
    .sk .info b { display: block; font-size: 22px; }
    .sk .pad {
      flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; gap: 12px;
      min-height: 300px; touch-action: none; user-select: none; -webkit-user-select: none;
    }
    .sk .pad button { border-radius: 22px; border: 0; color: #fff; background: #3a3f47; touch-action: none; transition: transform .05s; }
    .sk .pad button:active { transform: scale(.96); }
    .sk .pad button svg { width: 52px; height: 52px; display: block; margin: 0 auto; }
    .sk .pad .up { grid-column: 2; grid-row: 1; }
    .sk .pad .left { grid-column: 1; grid-row: 2; }
    .sk .pad .right { grid-column: 3; grid-row: 2; }
    .sk .pad .down { grid-column: 2; grid-row: 3; }
    .sk .pad .mid { grid-column: 2; grid-row: 2; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 15px; }
    .sk.go .pad button { background: #3fb27f; }
    .sk.off .pad button { background: #262a30; color: #8b919a; }
  `;
  const ICONS = {
    up: '<path d="M5 15l7-7 7 7" />',
    down: '<path d="M5 9l7 7 7-7" />',
    left: '<path d="M15 5l-7 7 7 7" />',
    right: '<path d="M9 5l7 7-7 7" />'
  };
  const SWIPE_PX = 24;
  let built = null;
  let last = { run: 0, phase: "", alive: true };
  const sound = (name) => window.PhoneSound && PhoneSound.play(name);

  function build(box, send) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    const wrap = document.createElement("div");
    wrap.className = "sk";
    const info = document.createElement("div");
    info.className = "info";
    const pad = document.createElement("div");
    pad.className = "pad";
    const isOn = () => wrap.classList.contains("go");
    const turn = (dir) => {
      if (!isOn()) return;
      if (navigator.vibrate) navigator.vibrate(8);
      send({ dir });
    };
    ["up", "left", "right", "down"].forEach((dir) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = dir;
      b.setAttribute("aria-label", dir);
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        ICONS[dir] + "</svg>";
      // pointerdown: a turn must not wait for the finger to lift.
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        swipe.used = true; // this touch was a button press, not a swipe
        turn(dir);
      });
      pad.appendChild(b);
    });
    const mid = document.createElement("div");
    mid.className = "mid muted";
    mid.textContent = "or swipe";
    pad.appendChild(mid);
    // A swipe anywhere on the pad turns as soon as the finger has moved far enough.
    const swipe = { x: 0, y: 0, used: true };
    pad.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      swipe.x = e.clientX;
      swipe.y = e.clientY;
      swipe.used = false;
    });
    pad.addEventListener("pointermove", (e) => {
      if (swipe.used) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      // Start again from here, so one long swipe with a bend makes two turns.
      swipe.x = e.clientX;
      swipe.y = e.clientY;
    });
    ["pointerup", "pointercancel"].forEach((t) => pad.addEventListener(t, () => { swipe.used = true; }));
    wrap.append(style, info, pad);
    box.replaceChildren(wrap);
    return { box, wrap, info, pad };
  }

  function nth(n) {
    return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  }

  window.GAMES.snake = {
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
      wrap.className = "sk " + (on ? "go" : "off");
      info.replaceChildren();
      const title = document.createElement("b");
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = "Game " + view.run + (view.mode === "solo" ? " · Solo" : " · " + view.players + " snakes");
      info.append(title, sub);
      if (!view.inRun) title.textContent = "You play in the next game";
      else if (view.phase === "countdown") title.textContent = "Get ready";
      else if (on) title.textContent = "Steer your snake";
      else if (view.phase === "playing") title.textContent = "Out with " + view.score + " apples";
      else if (view.mode === "solo") title.textContent = view.newRecord === 1 ? "New record! " + view.score + " apples" : view.score + " apples";
      else title.textContent = view.place === 1 ? "You won!" : "You were " + nth(view.place);
    }
  };
})();
