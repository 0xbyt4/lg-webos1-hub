// Quiz with a fake Claude: the request, Solo and Together flows, scoring, records, watchers.
var assert = require("assert");
var h = require("./harness.js");
var quiz = require("../services/home/games/quiz.js");

var Q = { questions: [] };
for (var i = 0; i < 10; i++) Q.questions.push({ question: "Question " + (i + 1) + "?", choices: ["right", "w1", "w2", "w3"], answer: 0, fact: "Fact " + (i + 1) });
Q.questions.push({ question: "bad", choices: ["a", "b"], answer: 0, fact: "x" }); // dropped: 2 choices

h.run(async function () {
  var asked = [];
  var t = h.makeHub({ ask: function (req, cb) { asked.push(req); setTimeout(function () { cb(null, JSON.stringify(Q)); }, 20); } });
  var tv = t.tv;
  await h.wait(10);
  var a = t.phone("Ana");
  var quizInfo = a.room().games.filter(function (g) { return g.id === "quiz"; })[0];
  assert.ok(quizInfo.topics.length > 0);

  // Together needs 2 players.
  a.say({ t: "start", game: "quiz", mode: "multi", topic: "history", lang: "tr-TR" });
  assert.ok(/at least 2 players/.test(a.errors().pop()));

  // Solo: the request, the hidden answer, scoring, the record.
  a.say({ t: "start", game: "quiz", mode: "solo", topic: "history", lang: "tr-TR" });
  await h.wait(5);
  assert.strictEqual(tv.room.view.phase, "loading");
  assert.strictEqual(asked.length, 1);
  assert.ok(/History/.test(asked[0].prompt) && /tr-TR/.test(asked[0].prompt));
  await h.wait(60);
  var v = tv.room.view;
  assert.deepStrictEqual([v.phase, v.number, v.total], ["question", 1, 8]);
  assert.strictEqual(v.answer, undefined, "the TV does not get the answer before the reveal");
  var pv = a.room().view;
  a.say({ t: "input", data: { answer: pv.choices.indexOf("right") } });
  await h.wait(10);
  v = tv.room.view;
  assert.strictEqual(v.phase, "reveal");
  assert.strictEqual(v.choices[v.answer], "right");
  assert.ok(v.results[0].points > 100 && v.results[0].points <= 200);
  assert.strictEqual(v.fact, "Fact 1");
  for (var n = 2; n <= 8; n++) {
    a.say({ t: "host", data: { next: true } });
    await h.wait(5);
    pv = a.room().view;
    a.say({ t: "input", data: { answer: pv.choices.indexOf(n % 2 ? "right" : "w1") } });
    await h.wait(5);
  }
  a.say({ t: "host", data: { next: true } });
  await h.wait(10);
  v = tv.room.view;
  assert.strictEqual(v.phase, "final");
  assert.strictEqual(v.newRecord, 1);
  assert.strictEqual(t.store.data.records["quiz:solo"][0].value, v.scores[0].score);

  // Solo buzzer: another phone only watches; its press does nothing.
  var b = t.phone("Bob");
  a.say({ t: "start", game: "buzzer", mode: "solo" });
  await h.wait(10);
  assert.strictEqual(b.room().watching, true);
  b.say({ t: "input", data: { press: true } });
  await h.wait(10);
  assert.deepStrictEqual(tv.room.view.falseStarts, []);

  // Together: the question waits for both answers.
  t.hub.room.paidAt = 0; // skip the 30-second pause between quiz starts
  a.say({ t: "start", game: "quiz", mode: "multi", topic: "music", lang: "en-US" });
  await h.wait(60);
  a.say({ t: "input", data: { answer: a.room().view.choices.indexOf("right") } });
  await h.wait(10);
  assert.strictEqual(tv.room.view.phase, "question");
  b.say({ t: "input", data: { answer: b.room().view.choices.indexOf("w2") } });
  await h.wait(10);
  v = tv.room.view;
  assert.strictEqual(v.phase, "reveal");
  assert.deepStrictEqual(v.results.map(function (r) { return r.name + ":" + (r.points > 0); }), ["Ana:true", "Bob:false"]);

  assert.strictEqual(quiz.cleanQuestions(Q, 8).length, 8, "bad questions are dropped, 8 kept");
});
