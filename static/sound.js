// Game sounds for the phone, made with Web Audio (no files to load). Phone browsers start
// audio only after a tap, so unlock() runs on the first tap of the game page.
(function () {
  let ctx = null;
  const SOUNDS = {
    tap: [[1200, 0, 0.04, "square"]],
    go: [[660, 0, 0.1, "square"], [990, 0.1, 0.2, "square"]],
    correct: [[784, 0, 0.1, "sine"], [1047, 0.1, 0.2, "sine"]],
    wrong: [[196, 0, 0.25, "sawtooth"]],
    win: [[523, 0, 0.1, "triangle"], [659, 0.1, 0.1, "triangle"], [784, 0.2, 0.1, "triangle"], [1047, 0.3, 0.35, "triangle"]]
  };

  function unlock() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    if (!ctx) ctx = new C();
    if (ctx.state === "suspended") ctx.resume();
  }

  function play(name) {
    const notes = SOUNDS[name];
    if (!notes || !ctx) return;
    const now = ctx.currentTime;
    for (const [freq, start, length, wave] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.2, now + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + length + 0.02);
    }
  }

  window.PhoneSound = { unlock, play };
})();
