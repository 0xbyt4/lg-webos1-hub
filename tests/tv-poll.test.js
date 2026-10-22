// The TV screen's long-polls with fake timers: no waiters pile up while the lobby sits idle,
// and the room closes after the TV screen stops polling.
var assert = require("assert");

var now = 0, timers = [], id = 0;
Date.now = function () { return now; };
global.setTimeout = function (fn, ms) { var t = { id: ++id, at: now + (ms || 0), fn: fn, iv: 0 }; timers.push(t); return t; };
global.setInterval = function (fn, ms) { var t = { id: ++id, at: now + ms, fn: fn, iv: ms }; timers.push(t); return t; };
global.clearTimeout = global.clearInterval = function (t) { timers = timers.filter(function (x) { return x !== t; }); };
function advance(ms) {
  var end = now + ms;
  for (;;) {
    timers.sort(function (a, b) { return a.at - b.at; });
    var t = timers[0];
    if (!t || t.at > end) break;
    now = t.at;
    if (t.iv) t.at += t.iv; else timers.shift();
    t.fn();
  }
  now = end;
}

var GameHub = require("../services/home/games.js").GameHub;
var hub = new GameHub({ log: function () {}, isLocal: function () { return true; }, playAddress: function () { return "x"; },
  store: { data: { records: {} }, save: function () {} }, ask: function () {} });
var version = 0, polling = true;
function poll() {
  hub.tvPoll(version, function (out) {
    version = out.version;
    if (polling) setTimeout(poll, 0);
  });
}
poll();
advance(10 * 60 * 1000); // the lobby stays open for 10 minutes
assert.ok(hub.tvChannel.waiters.length <= 1, "no waiters pile up");
assert.ok(hub.room, "the room stays open while the TV polls");
polling = false; // the TV screen goes away (Home key)
advance(10 * 60 * 1000);
assert.strictEqual(hub.tvChannel.closed, true);
assert.strictEqual(hub.room, null);
console.log("ok");
