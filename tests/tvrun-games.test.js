// Hub logic of the games that run on the TV (Sky Hop, Block Drop, Snake Arena): input to
// the TV, reports from the TV, places, records, rotation of places and limits.
var assert = require("assert");
var h = require("./harness.js");

h.run(async function () {
  var t = h.makeHub();
  var tv = t.tv;
  await h.wait(10);
  var names = ["Ana", "Bob", "Cem", "Dee", "Eva", "Fay"];
  var phones = names.map(function (n) { return t.phone(n); });
  var ids = phones[0].room().games.map(function (g) { return g.id; });
  assert.deepStrictEqual(ids, ["hop", "blocks", "snake", "quiz", "buzzer"]);
  function names_(list) { return list.map(function (r) { return r.name; }); }
  function standings() { return tv.room.view.standings.map(function (s) { return s.name + ":" + s.score; }); }

  // Sky Hop, Together: taps go to the TV only while playing and only for players in the run.
  phones[0].say({ t: "start", game: "hop", mode: "multi" });
  await h.wait(20);
  assert.strictEqual(tv.room.view.phase, "countdown");
  assert.ok(tv.room.view.seed > 0);
  phones[0].say({ t: "input", data: { hop: true } });
  await h.wait(3100);
  assert.strictEqual(tv.room.view.phase, "playing");
  assert.strictEqual(tv.events.length, 0, "a tap in the countdown is dropped");
  var late = t.phone("Gus");
  await h.wait(20);
  assert.strictEqual(late.room().view.inRun, false);
  late.say({ t: "input", data: { hop: true } });
  phones[1].say({ t: "input", data: { hop: true } });
  phones[1].say({ t: "input", data: { jump: true } });
  await h.wait(80);
  assert.deepStrictEqual(tv.events.map(function (e) { return [e.t, e.id, e.hop]; }), [["input", 2, true]]);
  var run = tv.room.view.run;
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [{ id: 2, score: 4 }] } });
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [{ id: 2, score: 99 }] } }); // twice: ignored
  t.hub.tvCommand({ t: "report", data: { run: run + 5, crashes: [{ id: 1, score: 99 }] } }); // wrong run
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [{ id: 3, score: 6 }, { id: 4, score: 6 }] } }); // a tie
  await h.wait(20);
  assert.strictEqual(tv.room.view.phase, "playing");
  assert.strictEqual(phones[2].room().view.place, phones[3].room().view.place, "a tie shares the place");
  // "over" ends the run even when a crash report was lost.
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [], over: true } });
  await h.wait(20);
  assert.strictEqual(tv.room.view.phase, "final");
  late.close();

  // Block Drop, Together: 4 wells at most, only the five moves pass.
  phones[0].say({ t: "stop" });
  phones[0].say({ t: "start", game: "blocks", mode: "multi" });
  await h.wait(20);
  assert.deepStrictEqual(names_(tv.room.view.racers), ["Ana", "Bob", "Cem", "Dee"]);
  assert.strictEqual(phones[4].room().view.inRun, false);
  await h.wait(3100);
  tv.events = [];
  ["left", "right", "rotate", "down", "drop", "hold", "", 5].forEach(function (m) { phones[1].say({ t: "input", data: { move: m } }); });
  phones[4].say({ t: "input", data: { move: "left" } });
  await h.wait(80);
  assert.deepStrictEqual(tv.events.map(function (e) { return e.move; }), ["left", "right", "rotate", "down", "drop"]);
  run = tv.room.view.run;
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [{ id: 3, score: 120 }, { id: 4, score: 80 }] } });
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [{ id: 2, score: 300 }], over: true, final: [{ id: 1, score: 450 }, { id: 9, score: 5 }] } });
  await h.wait(20);
  assert.deepStrictEqual(standings(), ["Ana:450", "Bob:300", "Cem:120", "Dee:80"]);
  assert.strictEqual(phones[2].room().view.place, 3);
  assert.strictEqual(phones[3].room().view.place, 3);
  assert.strictEqual(tv.room.view.standings[0].wins, 1);

  // Places rotate: the players with the fewest runs play first.
  phones[0].say({ t: "host", data: { next: true } });
  await h.wait(20);
  assert.deepStrictEqual(names_(tv.room.view.racers), ["Ana", "Bob", "Eva", "Fay"]);
  await h.wait(3100);
  // At most 25 inputs a second per player reach the TV (more than 30 messages a second
  // close the phone's connection, see RATE_PER_SECOND in games.js).
  tv.events = [];
  for (var n = 0; n < 29; n++) phones[4].say({ t: "input", data: { move: "left" } });
  await h.wait(80);
  assert.strictEqual(tv.events.length, 25);
  // Score updates: a run that hits the time limit ends with real scores.
  run = tv.room.view.run;
  t.hub.tvCommand({ t: "report", data: { run: run, crashes: [], scores: [{ id: 5, score: 700 }, { id: 6, score: 650 }, { id: 1, score: -5 }, { id: 2, score: 1e9 }] } });
  t.hub.room.game.instance.endRun(); // what the 15-minute limit does
  await h.wait(20);
  assert.deepStrictEqual(standings(), ["Eva:700", "Fay:650", "Ana:0", "Bob:0"]);
  phones[0].say({ t: "host", data: { next: true } });
  await h.wait(20);
  assert.deepStrictEqual(names_(tv.room.view.racers), ["Cem", "Dee", "Eva", "Fay"]);

  // Solo: only the host plays, the best scores are kept.
  phones[0].say({ t: "stop" });
  phones[0].say({ t: "start", game: "blocks", mode: "solo" });
  await h.wait(3100);
  assert.deepStrictEqual(names_(tv.room.view.racers), ["Ana"]);
  assert.strictEqual(phones[1].room().watching, true);
  t.hub.tvCommand({ t: "report", data: { run: tv.room.view.run, crashes: [{ id: 1, score: 2300 }], over: true, final: [] } });
  await h.wait(20);
  assert.strictEqual(tv.room.view.newRecord, 1);
  assert.strictEqual(t.store.data.records["blocks:solo"][0].value, 2300);

  // Snake Arena: 8 snakes at most (6 here), only the four directions pass.
  phones[0].say({ t: "stop" });
  phones[0].say({ t: "start", game: "snake", mode: "multi" });
  await h.wait(3100);
  assert.strictEqual(tv.room.view.racers.length, 6);
  tv.events = [];
  ["up", "down", "left", "right", "north", null].forEach(function (d) { phones[5].say({ t: "input", data: { dir: d } }); });
  await h.wait(80);
  assert.deepStrictEqual(tv.events.map(function (e) { return e.dir; }), ["up", "down", "left", "right"]);

  // Solo with the player's phone gone: the next run ends at once instead of waiting.
  phones[0].say({ t: "stop" });
  phones[0].say({ t: "start", game: "hop", mode: "solo" });
  await h.wait(3100);
  phones[0].close();
  t.hub.tvCommand({ t: "report", data: { run: tv.room.view.run, crashes: [{ id: 1, score: 2 }], over: true } });
  await h.wait(20);
  phones[1].say({ t: "host", data: { next: true } }); // Bob is the host now
  await h.wait(20);
  assert.strictEqual(tv.room.view.phase, "final");
  assert.strictEqual(tv.room.view.racers.length, 0);
});
