// Paid quiz requests cannot be spammed, and a stopped quiz cannot change anything later.
var assert = require("assert");
var h = require("./harness.js");

var Q = { questions: [] };
for (var i = 0; i < 8; i++) Q.questions.push({ question: "Q" + i + "?", choices: ["r", "a", "b", "c"], answer: 0, fact: "f" });

h.run(async function () {
  var pending = [];
  var t = h.makeHub({ ask: function (req, cb) { pending.push(cb); } });
  await h.wait(10);
  var a = t.phone("Ana");
  for (var k = 0; k < 25; k++) a.say({ t: "start", game: "quiz", mode: "solo" });
  assert.strictEqual(pending.length, 1, "one paid request at a time");
  assert.strictEqual(a.errors().length, 24);

  // Stopped while loading; the answer arrives late and must not start or record anything.
  a.say({ t: "stop" });
  pending[0](null, JSON.stringify(Q));
  assert.strictEqual(t.hub.room.game, null);
  assert.deepStrictEqual(t.store.data.records, {});

  // A free game starts at once; another quiz only after the pause between starts.
  a.say({ t: "start", game: "buzzer", mode: "solo" });
  assert.strictEqual(t.hub.room.game.module.id, "buzzer");
  a.say({ t: "start", game: "quiz", mode: "solo" });
  assert.strictEqual(pending.length, 1, "the 30-second pause");
  t.hub.room.paidAt = 0;
  a.say({ t: "start", game: "quiz", mode: "solo" });
  assert.strictEqual(pending.length, 2);

  // A wrong room code is refused.
  var x = t.phone();
  var wrong = ("000" + ((Number(t.hub.room.code) + 1) % 10000)).slice(-4);
  x.say({ t: "hello", role: "player", code: wrong, name: "x" });
  assert.ok(x.closed);
});
