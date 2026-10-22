// Quiz, phone part: the question and four big colored answer buttons. After an answer the
// phone waits for the others; then it shows right or wrong and the points.
(function () {
  const LETTERS = ["A", "B", "C", "D"];
  const COLORS = ["#e5484d", "#4f8cff", "#f2b24c", "#3fb27f"];
  const STYLE = `
    .qz { flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .qz .head { display: flex; justify-content: space-between; color: var(--muted); font-size: 14px; }
    .qz .q { font-size: 20px; font-weight: 600; line-height: 1.3; }
    .qz .grid { flex: 1; display: grid; grid-template-rows: repeat(4, 1fr); gap: 10px; min-height: 280px; }
    .qz .ans { display: flex; align-items: center; gap: 14px; text-align: left; border-radius: 18px; padding: 0 16px;
      font-size: 18px; font-weight: 600; color: #fff; border: 0; min-height: 64px; }
    .qz .ans b { flex: none; width: 40px; height: 40px; line-height: 40px; text-align: center; border-radius: 12px;
      background: rgba(0, 0, 0, .25); font-size: 20px; }
    .qz .ans.picked { outline: 4px solid #fff; }
    .qz .ans.dim { opacity: .3; }
    .qz .msg { text-align: center; margin: auto 0; }
    .qz .msg h2 { font-size: 26px; margin: 0 0 8px; }
    .qz .good { color: #3fb27f; }
    .qz .bad { color: #e5484d; }
  `;
  let last = { phase: "", number: 0 };
  const sound = (name) => window.PhoneSound && PhoneSound.play(name);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function message(wrap, title, text, cls) {
    const m = el("div", "msg");
    m.append(el("h2", cls || "", title), el("p", "muted", text));
    wrap.appendChild(m);
  }

  window.GAMES.quiz = {
    render(box, view, send) {
      const changed = view.phase !== last.phase || view.number !== last.number;
      last = { phase: view.phase, number: view.number };
      const wrap = el("div", "qz");
      const style = el("style");
      style.textContent = STYLE;
      wrap.appendChild(style);
      box.replaceChildren(wrap);

      if (view.phase === "loading") return message(wrap, "Get ready", "Claude is writing the questions...");
      if (view.phase === "error") return message(wrap, "No questions", view.error, "bad");
      if (view.phase === "final") {
        if (changed) sound(view.place === 1 || view.newRecord === 1 ? "win" : "correct");
        const title = view.mode === "solo"
          ? (view.newRecord === 1 ? "New record!" : view.score + " points")
          : view.place === 1 ? "You won!" : "You are number " + view.place + " of " + view.players;
        return message(wrap, title, view.mode === "solo" ? "Your score: " + view.score + ". See the best scores on the TV." : "Your points: " + view.score);
      }

      const head = el("div", "head");
      head.append(el("span", null, "Question " + view.number + " of " + view.total), el("span", null, view.score + " points"));
      wrap.append(head, el("div", "q", view.question));
      const grid = el("div", "grid");
      view.choices.forEach((text, i) => {
        const b = el("button", "ans");
        b.type = "button";
        b.style.background = COLORS[i];
        b.append(el("b", null, LETTERS[i]), el("span", null, text));
        if (view.phase === "question") {
          if (view.myChoice === i) b.classList.add("picked");
          else if (view.myChoice != null) b.classList.add("dim");
          if (view.myChoice == null) {
            b.addEventListener("pointerdown", (e) => {
              e.preventDefault();
              if (navigator.vibrate) navigator.vibrate(15);
              sound("tap");
              send({ answer: i });
            });
          }
        } else {
          if (i !== view.answer) b.classList.add("dim");
          if (view.myChoice === i) b.classList.add("picked");
        }
        grid.appendChild(b);
      });
      wrap.appendChild(grid);
      if (view.phase === "question" && view.myChoice != null) wrap.appendChild(el("p", "muted", "Locked in. Waiting for the others..."));
      if (view.phase === "reveal") {
        const right = view.myChoice === view.answer;
        if (changed) sound(right ? "correct" : "wrong");
        wrap.appendChild(el("p", right ? "good" : "bad",
          view.myChoice == null ? "No answer this time" : right ? "Right! +" + view.points + " points" : "Not this time"));
      }
    }
  };
})();
