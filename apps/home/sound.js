// Game sounds for the TV (ES5, WebKit 537), made with Web Audio oscillators.
// Tested on webOS 1.4: Web Audio plays at once, while <audio> files start 1-3 seconds
// late and decodeAudioData cannot read MP3, so the sounds are generated, not loaded.
(function () {
  var Context = window.AudioContext || window.webkitAudioContext;
  var ctx = null;

  // Each sound is a list of notes: [frequency in Hz, start in s, length in s, wave].
  var SOUNDS = {
    join: [[880, 0, 0.08, "sine"], [1320, 0.08, 0.1, "sine"]],
    tick: [[1000, 0, 0.05, "square"]],
    go: [[660, 0, 0.12, "square"], [990, 0.12, 0.25, "square"]],
    correct: [[784, 0, 0.12, "sine"], [1047, 0.12, 0.22, "sine"]],
    wrong: [[196, 0, 0.3, "sawtooth"]],
    question: [[523, 0, 0.1, "sine"], [659, 0.1, 0.1, "sine"], [784, 0.2, 0.18, "sine"]],
    win: [[523, 0, 0.12, "triangle"], [659, 0.12, 0.12, "triangle"], [784, 0.24, 0.12, "triangle"], [1047, 0.36, 0.4, "triangle"]],
    record: [[784, 0, 0.1, "triangle"], [988, 0.1, 0.1, "triangle"], [1175, 0.2, 0.1, "triangle"], [1568, 0.3, 0.5, "triangle"]]
  };

  function play(name) {
    var notes = SOUNDS[name];
    if (!notes || !Context) return;
    try {
      if (!ctx) ctx = new Context();
      var now = ctx.currentTime;
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i];
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = n[3];
        osc.frequency.value = n[0];
        // A short fade in and out, so the notes do not click.
        gain.gain.setValueAtTime(0, now + n[1]);
        gain.gain.linearRampToValueAtTime(0.25, now + n[1] + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + n[1] + n[2]);
        osc.connect(gain);
        gain.connect(ctx.destination);
        (osc.start || osc.noteOn).call(osc, now + n[1]);
        (osc.stop || osc.noteOff).call(osc, now + n[1] + n[2] + 0.02);
      }
    } catch (e) {
      // No sound is better than a broken game.
    }
  }

  window.TVSound = { play: play };
})();
