// End to end over the real server: phones on WebSockets, the TV screen on HTTP long-polls.
// Covers joining, a wrong code, the Buzzer, host controls, a reconnect with the token and
// closing the room. Needs Node.js 22 or later (built-in WebSocket client).
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var http = require("http");
var h = require("./harness.js");

var PORT = 18700 + Math.floor(Math.random() * 200);
process.env.HUB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
process.on("exit", function () { fs.rmSync(process.env.HUB_DATA, { recursive: true, force: true }); });
var realLog = console.log;
console.log = function () {}; // the server logs every request
require("../services/home/server.js").start([PORT], { uninstall: function (id, cb) { cb(null); } });

// The TV Games screen: long-polls like apps/home/games.html.
function fakeTv() {
  var tv = { last: null, version: 0 };
  function req(method, p, body, cb) {
    var data = body ? JSON.stringify(body) : null;
    var r = http.request({ host: "127.0.0.1", port: PORT, method: method, path: p,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, function (res) {
      var c = [];
      res.on("data", function (x) { c.push(x); });
      res.on("end", function () { try { cb(JSON.parse(Buffer.concat(c).toString())); } catch (e) { cb(null); } });
    });
    r.on("error", function () { cb(null); });
    r.end(data);
  }
  (function poll() {
    req("GET", "/api/games/tv?since=" + tv.version, null, function (out) {
      if (out) { tv.version = out.version; if (out.room) tv.last = out.room; }
      setTimeout(poll, out ? 0 : 300);
    });
  })();
  tv.send = function (o) { req("POST", "/api/games/tv", o, function () {}); };
  return tv;
}

function client(hello) {
  return new Promise(function (resolve) {
    var ws = new WebSocket("ws://127.0.0.1:" + PORT + "/ws");
    var c = { ws: ws, last: null, msgs: [], send: function (o) { ws.send(JSON.stringify(o)); } };
    ws.onmessage = function (e) { var m = JSON.parse(e.data); c.msgs.push(m); if (m.t === "room") c.last = m; };
    ws.onclose = function () { c.closed = true; };
    ws.onopen = function () { c.send(hello); resolve(c); };
  });
}

async function until(fn, what) {
  for (var i = 0; i < 400; i++) {
    if (fn()) return;
    await h.wait(25);
  }
  throw new Error("timed out: " + what);
}

h.run(async function () {
  await h.wait(300);
  var tv = fakeTv();
  await until(function () { return tv.last; }, "room");
  assert.ok(/^\d{4}$/.test(tv.last.code));
  var wrong = ("000" + ((Number(tv.last.code) + 1) % 10000)).slice(-4);
  var bad = await client({ t: "hello", role: "player", code: wrong, name: "x" });
  await until(function () { return bad.closed; }, "wrong code closed");

  var a = await client({ t: "hello", role: "player", code: tv.last.code, name: "Ana<script>" });
  var b = await client({ t: "hello", role: "player", code: tv.last.code, name: "Bob" });
  await until(function () { return tv.last.players.length === 2 && a.last && b.last; }, "two players");
  assert.strictEqual(tv.last.players[0].name.indexOf("<"), -1, "names lose markup");
  assert.strictEqual(a.last.host, true);
  assert.strictEqual(b.last.host, false);

  // Only the host can start, advance and stop.
  b.send({ t: "start", game: "buzzer" });
  await h.wait(200);
  assert.strictEqual(tv.last.game, null);
  a.send({ t: "start", game: "buzzer" });
  await until(function () { return tv.last.game === "buzzer"; }, "buzzer started");
  await until(function () { return a.last.view && a.last.view.phase === "go"; }, "GO");
  a.send({ t: "input", data: { press: true } });
  await until(function () { return tv.last.view.phase === "result"; }, "result");
  assert.strictEqual(tv.last.view.scores[0].score, 1);
  a.send({ t: "host", data: { next: true } });
  await until(function () { return tv.last.view.round === 2; }, "round 2");
  b.send({ t: "stop" });
  await h.wait(200);
  assert.strictEqual(tv.last.game, "buzzer");
  a.send({ t: "stop" });
  await until(function () { return tv.last.game === null; }, "stopped");

  // A phone that reconnects with its token keeps its name.
  var token = a.msgs.filter(function (m) { return m.t === "joined"; })[0].token;
  a.ws.close();
  await until(function () { return b.last.host === true; }, "Bob becomes host");
  var a2 = await client({ t: "hello", role: "player", code: tv.last.code, name: "ignored", token: token });
  await until(function () { return tv.last.players.every(function (p) { return p.connected; }); }, "reconnected");
  assert.strictEqual(tv.last.players.length, 2);
  assert.notStrictEqual(a2.msgs.filter(function (m) { return m.t === "joined"; })[0].name, "ignored");

  // The TV closes the room: every phone is told and closed.
  tv.send({ t: "close" });
  await until(function () { return a2.closed && b.closed; }, "phones closed");
  assert.strictEqual(b.msgs[b.msgs.length - 1].t, "closed");
  console.log = realLog;
});
