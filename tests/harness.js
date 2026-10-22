// Shared helpers for the tests: a game hub with a fake store, fake phone connections and a
// fake TV screen that long-polls like apps/home/games.html.
var GameHub = require("../services/home/games.js").GameHub;

function makeHub(opts) {
  opts = opts || {};
  var store = { data: { records: opts.records || {} }, save: function () {} };
  var hub = new GameHub({
    log: function () {},
    isLocal: function () { return true; },
    playAddress: function () { return "http://192.168.1.50:8765/play"; },
    store: store,
    ask: opts.ask || function () {}
  });
  var tv = { version: 0, room: null, events: [] };
  (function poll() {
    hub.tvPoll(tv.version, function (out) {
      tv.version = out.version;
      if (out.room) tv.room = out.room;
      tv.events = tv.events.concat(out.events);
      setImmediate(poll);
    });
  })();

  // A phone: messages from the hub land in c.sent; c.say(msg) sends one to the hub.
  function phone(name) {
    var c = { remoteAddress: "phone-" + name, sent: [], closed: false };
    c.sendJson = function (o) { c.sent.push(o); };
    c.close = function () { if (!c.closed) { c.closed = true; c.onclose(); } };
    hub.connect(c);
    c.say = function (o) { c.onmessage(JSON.stringify(o)); };
    c.room = function () { var r = c.sent.filter(function (m) { return m.t === "room"; }); return r[r.length - 1]; };
    c.errors = function () { return c.sent.filter(function (m) { return m.t === "error"; }).map(function (m) { return m.error; }); };
    if (name) c.say({ t: "hello", role: "player", code: hub.room.code, name: name });
    return c;
  }

  return { hub: hub, store: store, tv: tv, phone: phone };
}

function wait(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Runs an async test body; a failed assert ends the process with exit code 1.
function run(body) {
  body().then(function () {
    console.log("ok");
    process.exit(0);
  }, function (e) {
    console.error(e && e.stack || e);
    process.exit(1);
  });
}

module.exports = { makeHub: makeHub, wait: wait, run: run };
