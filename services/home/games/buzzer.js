// Buzzer: who presses first after "Go"? (Node 0.10, ES5)
//
// Each round: "Get ready" for 2-5 seconds, then "Go". The first press scores a point.
// A press before "Go" is a false start for that round. The round ends when everyone has
// pressed, or 5 seconds after "Go"; the next one starts by itself, or with OK on the TV.
// Reaction times are measured on the hub, so they include the network delay of the phone.
// Solo: one player against the clock; the best times are kept as records.
// Together: 2-8 players; the first press scores a point.
var GO_DELAY_MIN = 2000;
var GO_DELAY_SPREAD = 3000;
var ROUND_MS = 5000;
var RESULT_MS = 6000;

function Buzzer(api) {
  this.api = api;
  this.round = 0;
  this.phase = "ready"; // ready -> wait -> go -> result -> wait ...
  this.goAt = 0;
  this.presses = []; // { id, ms } in press order
  this.falseStarts = {};
  this.scores = {};
  this.known = {}; // id -> { name, color }, also for players who left
  this.best = null; // solo: best time in this game
  this.newRecord = 0; // solo: place in the records of the last round, 0 = none
}

Buzzer.prototype.start = function () {
  this.nextRound();
};

Buzzer.prototype.nextRound = function () {
  var self = this;
  this.round++;
  var round = this.round;
  this.phase = "wait";
  this.presses = [];
  this.falseStarts = {};
  this.newRecord = 0;
  this.api.update();
  this.api.later(function () { if (self.round === round) self.go(); }, GO_DELAY_MIN + Math.floor(Math.random() * GO_DELAY_SPREAD));
};

Buzzer.prototype.go = function () {
  var self = this;
  var round = this.round;
  this.phase = "go";
  this.goAt = Date.now();
  this.api.update();
  this.api.later(function () { if (self.round === round) self.finish(); }, ROUND_MS);
};

Buzzer.prototype.finish = function () {
  var self = this;
  if (this.phase !== "go") return;
  var round = this.round;
  this.phase = "result";
  if (this.api.mode === "solo" && this.presses.length) {
    var ms = this.presses[0].ms;
    if (this.best === null || ms < this.best) this.best = ms;
    var who = this.known[this.presses[0].id];
    this.newRecord = this.api.saveRecord("buzzer:solo", { name: who.name, value: ms }, true);
  }
  this.api.update();
  this.api.later(function () { if (self.round === round && self.phase === "result") self.nextRound(); }, RESULT_MS);
};

Buzzer.prototype.pressed = function (id) {
  for (var i = 0; i < this.presses.length; i++) if (this.presses[i].id === id) return this.presses[i];
  return null;
};

Buzzer.prototype.onInput = function (player, data) {
  if (!data.press) return;
  this.known[player.id] = { name: player.name, color: player.color };
  if (this.phase === "wait") {
    if (!this.falseStarts[player.id]) {
      this.falseStarts[player.id] = true;
      this.api.update();
    }
    return;
  }
  if (this.phase !== "go" || this.falseStarts[player.id] || this.pressed(player.id)) return;
  this.presses.push({ id: player.id, ms: Date.now() - this.goAt });
  if (this.presses.length === 1) this.scores[player.id] = (this.scores[player.id] || 0) + 1;
  var self = this;
  var waiting = this.api.players().filter(function (p) { return !self.pressed(p.id) && !self.falseStarts[p.id]; });
  if (!waiting.length) this.finish();
  else this.api.update();
};

// OK on the TV remote: start the next round now.
Buzzer.prototype.onHost = function (data) {
  if (data.next && this.phase === "result") this.nextRound();
};

Buzzer.prototype.tvView = function () {
  var self = this;
  var known = this.known;
  this.api.players().forEach(function (p) { known[p.id] = { name: p.name, color: p.color }; });
  // Results keep players who left during the round, so the winner shown is the real one.
  var results = this.presses.map(function (r) {
    return { name: known[r.id].name, color: known[r.id].color, ms: r.ms };
  });
  var falseStarts = Object.keys(this.falseStarts).map(function (id) { return known[id]; });
  // Points: everyone here now, plus anyone who left with points.
  var here = {};
  this.api.players().forEach(function (p) { here[p.id] = true; });
  var scores = Object.keys(known).filter(function (id) { return here[id] || self.scores[id]; }).map(function (id) {
    return { name: known[id].name, color: known[id].color, score: self.scores[id] || 0 };
  }).sort(function (a, b) { return b.score - a.score; });
  return {
    phase: this.phase, round: this.round, mode: this.api.mode, results: results, falseStarts: falseStarts, scores: scores,
    best: this.best, newRecord: this.newRecord,
    records: this.api.mode === "solo" ? this.api.records("buzzer:solo") : null
  };
};

Buzzer.prototype.playerView = function (player) {
  var mine = this.pressed(player.id);
  var place = 0;
  for (var i = 0; i < this.presses.length; i++) if (this.presses[i].id === player.id) place = i + 1;
  return {
    phase: this.phase,
    round: this.round,
    pressed: !!mine,
    ms: mine ? mine.ms : null,
    place: place,
    falseStart: !!this.falseStarts[player.id],
    score: this.scores[player.id] || 0,
    mode: this.api.mode,
    best: this.best,
    newRecord: this.newRecord
  };
};

module.exports = {
  id: "buzzer",
  title: "Buzzer",
  description: "Press your phone when the TV says Go. Solo: beat your best time. Together: the fastest wins the round.",
  modes: ["solo", "multi"],
  create: function (api) { return new Buzzer(api); }
};
