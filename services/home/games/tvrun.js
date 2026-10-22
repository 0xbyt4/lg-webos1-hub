// Shared hub logic for real-time games whose play runs on the TV screen (Node 0.10, ES5):
// Sky Hop, Block Drop, Snake Arena.
//
// The hub starts each run (a 3-second countdown and a random seed), sends every phone
// input to the TV at once (api.tvEvent) and keeps the standings from what the TV reports:
// who is out, with which score. Solo: one player, the best scores are kept as records.
// Together: every player in the run (up to maxPlayers); the last one in wins.
//
// make(def) returns a game module. def: { id, title, description, maxPlayers,
//   input(data) -> the event fields to send to the TV, or null to ignore the input }.
// TV report: { run, crashes: [{ id, score }], over, final: [{ id, score }], scores }.
// Players out in the same report share a place. "over" ends the run even if an earlier
// report was lost: nobody is still in, or (Block Drop, Snake Arena) one player is left
// and wins; "final" has the scores of the players still in at that moment. "scores"
// (every 10 s) has the scores of the players still in, for a run that hits MAX_RUN_MS.
var COUNTDOWN_MS = 3000;
var MAX_SCORE = 999999;
var MAX_RUN_MS = 15 * 60 * 1000; // a run cannot last longer than this
var MAX_INPUTS_PER_SECOND = 25; // per player; more would push other players' input out of the TV queue

function make(def) {
  var maxPlayers = def.maxPlayers || 8;
  var recordKey = def.id + ":solo";

  function Run(api) {
    this.api = api;
    this.phase = "ready"; // countdown -> playing -> final
    this.run = 0;
    this.seed = 0;
    this.racers = []; // { id, name, color, alive, score, place }
    this.wins = {}; // together: player id -> runs won
    this.runsPlayed = {}; // player id -> runs played, to share the places fairly
    this.newRecord = 0;
  }

  Run.prototype.start = function () {
    this.nextRun();
  };

  Run.prototype.nextRun = function () {
    var self = this;
    this.run++;
    var run = this.run;
    this.phase = "countdown";
    this.seed = 1 + Math.floor(Math.random() * 2147483646);
    this.newRecord = 0;
    // The players at the start of the run play; anyone who joins later waits for the next.
    // With more players than places, those who played the fewest runs play first.
    var players = this.api.players(), runs = this.runsPlayed;
    var chosen = players.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      return (runs[a.p.id] || 0) - (runs[b.p.id] || 0) || a.i - b.i;
    }).slice(0, maxPlayers).map(function (x) { return x.p; });
    chosen.forEach(function (p) { runs[p.id] = (runs[p.id] || 0) + 1; });
    this.racers = players.filter(function (p) { return chosen.indexOf(p) >= 0; }).map(function (p) {
      return { id: p.id, name: p.name, color: p.color, alive: true, score: 0, place: 0, inputs: 0, inputsAt: 0 };
    });
    if (!this.racers.length) {
      // Nobody can play (the solo player's phone is locked, or every phone left).
      this.phase = "final";
      return this.api.update();
    }
    this.api.update();
    this.api.later(function () {
      if (self.run !== run) return;
      self.phase = "playing";
      self.api.update();
    }, COUNTDOWN_MS);
    this.api.later(function () { if (self.run === run && self.phase === "playing") self.endRun(); }, COUNTDOWN_MS + MAX_RUN_MS);
  };

  Run.prototype.racer = function (id) {
    for (var i = 0; i < this.racers.length; i++) if (this.racers[i].id === id) return this.racers[i];
    return null;
  };

  Run.prototype.onInput = function (player, data) {
    if (this.phase !== "playing") return;
    var r = this.racer(player.id);
    if (!r || !r.alive) return;
    var now = Date.now();
    if (now - r.inputsAt >= 1000) {
      r.inputsAt = now;
      r.inputs = 0;
    }
    if (++r.inputs > MAX_INPUTS_PER_SECOND) return;
    var fields = def.input(data);
    if (!fields) return;
    var event = { t: "input", id: player.id, run: this.run };
    for (var k in fields) if (fields.hasOwnProperty(k)) event[k] = fields[k];
    this.api.tvEvent(event);
  };

  Run.prototype.onTvReport = function (data) {
    if (data.run !== this.run || this.phase !== "playing") return;
    var self = this;
    if (data.scores instanceof Array) {
      data.scores.slice(0, maxPlayers).forEach(function (c) {
        var r = c && self.racer(c.id);
        var score = r && r.alive ? Number(c.score) : -1;
        if (score >= 0 && score <= MAX_SCORE) r.score = Math.floor(score);
      });
    }
    var crashes = data.crashes instanceof Array ? data.crashes.slice(0, maxPlayers) : [];
    var newly = [];
    crashes.forEach(function (c) {
      var r = c && self.racer(c.id);
      if (!r || !r.alive || newly.indexOf(r) >= 0) return;
      var score = Number(c.score);
      r.score = score >= 0 && score <= MAX_SCORE ? Math.floor(score) : 0;
      newly.push(r);
    });
    newly.forEach(function (r) { r.alive = false; });
    var place = this.racers.filter(function (x) { return x.alive; }).length + 1;
    newly.forEach(function (r) { r.place = place; });
    if (data.over === true) {
      var final = data.final instanceof Array ? data.final.slice(0, maxPlayers) : [];
      this.racers.forEach(function (r) {
        if (!r.alive) return;
        final.forEach(function (f) {
          var score = f && f.id === r.id ? Number(f.score) : -1;
          if (score >= 0 && score <= MAX_SCORE) r.score = Math.floor(score);
        });
        r.alive = false;
        r.place = 1;
      });
    }
    if (!this.racers.some(function (x) { return x.alive; })) this.endRun();
    else if (newly.length) this.api.update();
  };

  Run.prototype.endRun = function () {
    this.phase = "final";
    var standings = this.standings();
    if (this.api.mode === "solo" && standings.length) {
      this.newRecord = this.api.saveRecord(recordKey, { name: standings[0].name, value: standings[0].score }, false);
    } else if (standings.length > 1) {
      this.wins[standings[0].id] = (this.wins[standings[0].id] || 0) + 1;
    }
    this.api.update();
  };

  // OK on the TV or Next on the host phone: start the next run after a final.
  Run.prototype.onHost = function (data) {
    if (data.next && this.phase === "final") this.nextRun();
  };

  // Best first: the last one in wins; then by score.
  Run.prototype.standings = function () {
    var self = this;
    return this.racers.slice().sort(function (a, b) {
      return (a.alive ? 0 : a.place || 99) - (b.alive ? 0 : b.place || 99) || b.score - a.score;
    }).map(function (r) {
      return { id: r.id, name: r.name, color: r.color, alive: r.alive, score: r.score, wins: self.wins[r.id] || 0 };
    });
  };

  Run.prototype.tvView = function () {
    return {
      phase: this.phase,
      mode: this.api.mode,
      run: this.run,
      seed: this.seed,
      racers: this.racers.map(function (r) { return { id: r.id, name: r.name, color: r.color, alive: r.alive, score: r.score }; }),
      standings: this.standings(),
      newRecord: this.newRecord,
      records: this.api.mode === "solo" ? this.api.records(recordKey) : null
    };
  };

  Run.prototype.playerView = function (player) {
    var r = this.racer(player.id);
    var standings = this.standings();
    var place = 0;
    for (var i = 0; i < standings.length; i++) if (standings[i].id === player.id) place = i + 1;
    if (r && !r.alive && r.place) place = r.place; // players out together share a place
    return {
      phase: this.phase,
      mode: this.api.mode,
      run: this.run,
      inRun: !!r, // false: joined after the start (or the run is full); plays in the next run
      alive: r ? r.alive : false,
      score: r ? r.score : 0,
      place: place,
      players: standings.length,
      newRecord: this.newRecord
    };
  };

  return {
    id: def.id,
    title: def.title,
    description: def.description,
    modes: ["solo", "multi"],
    create: function (api) { return new Run(api); }
  };
}

module.exports = { make: make };
